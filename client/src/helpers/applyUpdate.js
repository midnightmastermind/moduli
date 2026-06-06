// helpers/applyUpdate.js
//
// Pure routing helper for the unified UPDATE verb. Parses a dotted path
// string (e.g. `$item.fields.<id>.value`, `$display.<fieldId>.<itemId>`,
// `$myVar`) and returns `{ effects, varWrites }` describing what should
// happen.
//
// This module is intentionally pure: no socket, no Redux, no React.
// The operations engine will call this helper and either apply the
// `varWrites` to its in-pipeline `$vars` map, or hand the `effects`
// off to the consumer (bindSocketToStore) for application.
//
// See plan: docs/superpowers/plans/2026-04-27-unified-operation-verbs.md
// (Task 1: applyUpdate helper).

// Reserved engine identifiers that may NOT be assigned via a single-segment
// `$<var>` write. These are produced by the executor and read by ops.
const RESERVED_VAR_NAMES = new Set([
  "$item",
  "$display",
  "$trigger",
  "$today",
  "$activeDate",
  "$activeDateLabel",
  "$activeDayOfWeek",
  "$nav",
  "$schedDate",
  "$schedDateLabel",
  "$allItems",
  "$allTemplates",
]);

const VAR_NAME_RE = /^\$[a-zA-Z_][a-zA-Z0-9_]*$/;

// ---------------------------------------------------------------------------
// textmap template substitution
// ---------------------------------------------------------------------------
// Mirrors the inline approach in operationActions.js's
// `COMPUTE_TEXTMAP_FROM_TEMPLATE` case: deep clone, walk every node, and
// replace `[token]` strings inside `text` nodes. Inlined here on purpose so
// applyUpdate stays self-contained.
export function substituteTextmapTokens(textmap, tokens) {
  if (textmap == null) return textmap;
  const cloned = JSON.parse(JSON.stringify(textmap));
  const tokenEntries = Object.entries(tokens || {});

  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "text" && typeof node.text === "string") {
      for (const [token, value] of tokenEntries) {
        const replacement = value == null ? "" : String(value);
        node.text = node.text.split(token).join(replacement);
      }
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child);
    }
  };

  walk(cloned);
  return cloned;
}

// ---------------------------------------------------------------------------
// applyUpdate
// ---------------------------------------------------------------------------
/**
 * Parse `path` and route the assignment to the right effect or var-write.
 *
 * @param {string} path  Dotted path. Examples:
 *                       - `$item.fields.<fieldId>.value`
 *                       - `$item.fields.<fieldId>.flow`
 *                       - `$item.parentId`
 *                       - `$item.meta.<key>`
 *                       - `$item.textmap`
 *                       - `$display.<fieldId>.<itemId>`
 *                       - `$<varName>` (single segment, pipeline-internal)
 * @param {*}      value The value to write.
 * @param {Object} ctx   `{ vars, occurrencesById }` — `vars` is the live
 *                       `$vars` map from the executor; `occurrencesById` is
 *                       used for `$item.textmap` template lookups.
 * @returns {{ effects: Array<Object>, varWrites: Object }}
 */
export function applyUpdate(path, value, ctx) {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error(`unknown path head: ${String(path)}`);
  }

  const vars = ctx?.vars || {};
  const occurrencesById = ctx?.occurrencesById || {};

  const segments = path.split(".");
  const head = segments[0];

  // -------------------------------------------------------------------------
  // Single-segment `$<var>` write — pipeline-internal var assignment.
  // -------------------------------------------------------------------------
  if (segments.length === 1) {
    if (!VAR_NAME_RE.test(head)) {
      throw new Error(`unknown path head: ${path}`);
    }
    if (RESERVED_VAR_NAMES.has(head)) {
      throw new Error(`cannot write reserved identifier: ${head}`);
    }
    return { effects: [], varWrites: { [head]: value } };
  }

  // -------------------------------------------------------------------------
  // `$item.*` paths — operate on the current loop item / trigger payload.
  // -------------------------------------------------------------------------
  if (head === "$item") {
    const item = vars.$item;
    if (item == null) {
      throw new Error("$item not bound in current pipeline context");
    }
    return routeRecordPath(path, segments, value, { item, occurrencesById });
  }

  // -------------------------------------------------------------------------
  // `$display.<fieldId>.<itemId>` — display-value publishing.
  // -------------------------------------------------------------------------
  if (head === "$display") {
    if (segments.length === 2) {
      throw new Error("display path requires itemId segment");
    }
    if (segments.length !== 3) {
      throw new Error(`unknown path head: ${path}`);
    }
    const [, fieldId, itemId] = segments;
    return {
      effects: [
        {
          _effect: "UPDATE_DISPLAY_VALUE",
          fieldId,
          itemId,
          value,
        },
      ],
      varWrites: {},
    };
  }

  // -------------------------------------------------------------------------
  // `$<var>.<...>` — write to any FOUND record bound to a user var by an
  // earlier FIND step (`itemVar: "$myVar"`). Reuses the same record routing
  // as `$item.*`.
  // -------------------------------------------------------------------------
  if (VAR_NAME_RE.test(head)) {
    const bound = vars[head];
    if (bound == null) {
      throw new Error(`${head} not bound in current pipeline context`);
    }
    if (typeof bound !== "object" || !bound.id) {
      throw new Error(`${head} is not a record (no .id) — UPDATE needs a FOUND occurrence`);
    }
    return routeRecordPath(path, segments, value, { item: bound, occurrencesById });
  }

  throw new Error(`unknown path head: ${path}`);
}

// ---------------------------------------------------------------------------
// routeRecordPath — shared sub-path routing for any var head bound to an
// occurrence-shaped record. Sub-paths: `fields.<fid>.value|.flow`,
// `parentId`, `meta.<key>`, `textmap`. Produces the same effect shapes the
// `$item.*` branch always has (UPDATE_ITEM_FIELD/PARENT/META/TEXTMAP) so
// downstream apply code is unchanged.
// ---------------------------------------------------------------------------
function routeRecordPath(path, segments, value, { item, occurrencesById }) {
  const itemId = item.id;

  if (segments[1] === "fields") {
    const fieldId = segments[2];
    const subKey = segments[3];
    if (!fieldId || (subKey !== "value" && subKey !== "flow")) {
      throw new Error(`unknown path head: ${path}`);
    }
    return {
      effects: [
        {
          _effect: "UPDATE_ITEM_FIELD",
          itemId,
          fieldId,
          value,
          subKind: subKey === "flow" ? "flow" : "value",
        },
      ],
      varWrites: {},
    };
  }

  if (segments[1] === "parentId" && segments.length === 2) {
    return {
      effects: [
        {
          _effect: "UPDATE_ITEM_PARENT",
          itemId,
          toParentId: value,
        },
      ],
      varWrites: {},
    };
  }

  // $occ.label — per-placement label override (UPDATE_ITEM_LABEL). The
  // renderer prefers occurrence.label over module.label, so an op can rename
  // a single placement (e.g. date-prefix goal/tracker labels) without touching
  // the shared module template. value coerced to string (null clears).
  if (segments[1] === "label" && segments.length === 2) {
    return {
      effects: [
        {
          _effect: "UPDATE_ITEM_LABEL",
          itemId,
          label: value == null ? null : String(value),
        },
      ],
      varWrites: {},
    };
  }

  if (segments[1] === "meta") {
    const metaPath = segments.slice(2);
    if (!metaPath.length) {
      throw new Error(`unknown path head: ${path}`);
    }
    return {
      effects: [
        {
          _effect: "UPDATE_ITEM_META",
          itemId,
          metaPath,
          value,
        },
      ],
      varWrites: {},
    };
  }

  // $slot.ownStyle.bg / .opacity / .borderRadius / etc.
  // Same shape as meta — writes a partial merge into occurrence.ownStyle.
  // Lets operations set per-occurrence visual properties (color, opacity,
  // basic non-layout styles) the same way the settings menu does, via the
  // existing operationsBridge.applyEffect path.
  if (segments[1] === "ownStyle") {
    const styleKey = segments[2];
    if (!styleKey) {
      throw new Error(`unknown path head: ${path}`);
    }
    return {
      effects: [
        {
          _effect: "UPDATE_ITEM_OWN_STYLE",
          itemId,
          styleKey,
          value,
        },
      ],
      varWrites: {},
    };
  }

  if (segments[1] === "textmap" && segments.length === 2) {
    let textmap = value;
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.prototype.hasOwnProperty.call(value, "fromTemplate")
    ) {
      const templateRef = value.fromTemplate;
      const templateOcc =
        occurrencesById[templateRef] ||
        occurrencesById[templateRef?.id] ||
        null;
      const sourceTextmap = templateOcc?.textmap ?? null;
      textmap = substituteTextmapTokens(sourceTextmap, value.tokens || {});
    }
    return {
      effects: [
        {
          _effect: "UPDATE_ITEM_TEXTMAP",
          itemId,
          textmap,
        },
      ],
      varWrites: {},
    };
  }

  throw new Error(`unknown path head: ${path}`);
}
