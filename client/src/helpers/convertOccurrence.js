// helpers/convertOccurrence.js
// ============================================================================
// Seamless occurrence conversion (2026-07-16 plan Part B1).
//
// Convert a CONTAINER occurrence between kinds (doc ↔ board ↔ list ↔ table)
// while preserving its children. `kind` lives on the MODULE; the render path is:
//   - doc   → renders the occurrence's `textmap` (moduleEmbed node per child)
//   - board/list/table → renders the occurrence's `occurrences[]` child list
// A doc container ALSO keeps its children in `occurrences[]` for ancestry
// (importer contract), so converting is a kind flip + a textmap materialize/clear
// — no child occurrences are minted, moved, or lost.
//
// `planContainerKindConversion` is PURE (unit-tested); `convertContainerKind`
// applies the plan through CommitHelpers (the only socket boundary).
// ============================================================================

import { updateModule, updateOccurrence } from "./CommitHelpers";

// Container kinds a container can convert between. "list" is NOT here — for
// CONTAINERS list == board (the list/board split only exists for PAGES); the
// four real container kinds are doc / board / canvas / table.
export const CONVERTIBLE_CONTAINER_KINDS = ["doc", "board", "canvas", "table"];
// Leaf roles that convert into each other (a typed textblock ↔ a data instance).
export const CONVERTIBLE_LEAF_ROLES = ["instance", "textblock"];

const moduleEmbedNode = (occurrenceId) => ({ type: "moduleEmbed", attrs: { occurrenceId } });

// Flatten a TipTap textmap to its plain text (paragraphs joined by newlines).
export function textmapToPlainText(textmap) {
  if (!textmap || typeof textmap !== "object") return "";
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.text === "string") out.push(node.text);
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(textmap);
  return out.join(" ").replace(/\s+/g, " ").trim();
}

const paragraphDoc = (text) => ({
  type: "doc",
  content: text ? [{ type: "paragraph", content: [{ type: "text", text }] }] : [{ type: "paragraph" }],
});

/**
 * Pure planner. Returns { modulePatch, occurrencePatch } (occurrencePatch may be
 * null when only the module kind changes), or null for a no-op (same kind /
 * missing inputs).
 */
export function planContainerKindConversion({ occurrence, module, targetKind }) {
  const fromKind = module?.kind;
  if (!module || !targetKind || fromKind === targetKind) return null;
  if (!CONVERTIBLE_CONTAINER_KINDS.includes(targetKind)) return null;

  const childIds = Array.isArray(occurrence?.occurrences) ? occurrence.occurrences : [];
  const modulePatch = { ...module, kind: targetKind };
  let occurrencePatch = null;

  if (targetKind === "doc") {
    // → doc: materialize a textmap that embeds each child in order. TipTap's
    // non-empty-content invariant needs at least one node when there are none.
    occurrencePatch = {
      ...occurrence,
      textmap: {
        type: "doc",
        content: childIds.length ? childIds.map(moduleEmbedNode) : [{ type: "paragraph" }],
      },
    };
  } else if (fromKind === "doc") {
    // doc → board/list/table: children already live in occurrences[]; drop the
    // now-unused doc textmap so it can't render stale embeds.
    occurrencePatch = { ...occurrence, textmap: null };
  }
  // board ↔ list ↔ table (non-doc → non-doc): kind flip only — both render
  // occurrences[]. (table seeds default columns lazily in the renderer.)

  return { modulePatch, occurrencePatch };
}

/**
 * Pure planner for a leaf ROLE conversion (textblock ↔ instance).
 *   textblock → instance: the prose flattens to the label (v1 — a bullet list of
 *     mini-textblocks becomes labelled instance rows); textmap cleared. kind:list.
 *   instance → textblock: the label seeds an editable prose textmap. kind:doc.
 * Returns { modulePatch, occurrencePatch } or null (no-op).
 */
export function planLeafRoleConversion({ occurrence, module, targetRole }) {
  const fromRole = module?.role;
  if (!module || !targetRole || fromRole === targetRole) return null;
  if (!CONVERTIBLE_LEAF_ROLES.includes(targetRole) || !CONVERTIBLE_LEAF_ROLES.includes(fromRole)) return null;

  if (targetRole === "instance") {
    const text = (occurrence?.label || module?.label || textmapToPlainText(occurrence?.textmap) || "").trim();
    return {
      modulePatch: { ...module, role: "instance", kind: "list" },
      occurrencePatch: { ...occurrence, textmap: null, label: text || null },
    };
  }
  // → textblock
  const label = (occurrence?.label || module?.label || "").trim();
  return {
    modulePatch: { ...module, role: "textblock", kind: "doc" },
    occurrencePatch: { ...occurrence, textmap: paragraphDoc(label) },
  };
}

function applyPlan({ dispatch, socket }, plan) {
  if (!plan) return null;
  updateModule({ dispatch, socket, module: plan.modulePatch });
  if (plan.occurrencePatch) updateOccurrence({ dispatch, socket, occurrence: plan.occurrencePatch });
  return plan;
}

/**
 * Apply a container kind conversion in place (transform this occurrence's
 * module). Optimistic — routes through CommitHelpers. Returns the plan (or null).
 */
export function convertContainerKind({ dispatch, socket, occurrence, module, targetKind }) {
  return applyPlan({ dispatch, socket }, planContainerKindConversion({ occurrence, module, targetKind }));
}

/** Apply a leaf role conversion (textblock ↔ instance) in place. */
export function convertLeafRole({ dispatch, socket, occurrence, module, targetRole }) {
  return applyPlan({ dispatch, socket }, planLeafRoleConversion({ occurrence, module, targetRole }));
}
