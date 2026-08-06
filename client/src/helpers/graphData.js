// helpers/graphData.js
// ============================================================
// PURE. Turns a graph occurrence into chart data. No React, no charting
// library — so the whole data model is testable without rendering anything.
//
// THE IDEA THE GRAPH ARCHITECTURE RESTS ON: a graph's data rows are its CHILD
// OCCURRENCES. That collapses the user's three data sources into one mechanism:
//
//   query / feed  → `occurrence.feed` ALREADY materializes its matches as
//                   copy-linked children (2026-07-07). Nothing new is built.
//   drag          → dropping an occurrence onto a container already adds a
//                   child. Nothing new is built.
//   hardcoded     → `meta.graph.literals`, appended after the occurrence rows.
//                   The only genuinely new path, and it is a list of pairs.
//
// A fed row and a hand-dragged row are deliberately INDISTINGUISHABLE here —
// the graph never learns where a row came from.
//
// THE SPEC lives in `occurrence.meta.graph`:
//   {
//     type: "sunburst" | "pie" | "bar" | "line" | …,
//     encoding: {
//       category: null | fieldId,   // null = the occurrence's LABEL (the common case)
//       value:    null | fieldId,   // null = count rows (a bare tally)
//       series:   null | fieldId,   // optional split into multiple series
//       children: "occurrences",    // nest by the occurrence TREE
//       parent:   null | fieldId,   // …or nest by a PARENT REFERENCE FIELD
//       level:    null | fieldId,   // optional: which ring a row belongs to
//     },
//     literals: [{ name, value }],
//   }
//
// TWO WAYS TO GET A HIERARCHY, and the second is the one boards want.
//
//   `children: "occurrences"` nests by the occurrence tree — natural when the
//   rows are already containers holding containers.
//
//   `parent: <fieldId>` builds the tree from a FIELD on each row that points at
//   its parent occurrence (user, 2026-08-06: "we can use fields to drive it.
//   like what level is what"). This is what lets a hierarchy live on a FLAT
//   BOARD: every feeling is a sibling occurrence tagged by fields, exactly like
//   every other board on this grid, and the wheel's 3 layers are data you can
//   edit in the app rather than a nesting you have to drag.
//
// Either way the graph learns the shape from configuration. It never learns
// what a feeling is.
// ============================================================

// Guards a pathological tree (and the cycle test) from recursing forever.
const MAX_DEPTH = 12;

function graphSpec(occ) {
  const g = occ?.meta?.graph;
  return g && typeof g === "object" ? g : null;
}

// A stored field value is either the `{value, flow}` wrapper or the bare value.
// Arrays pass through untouched — treating an array as "object without a value
// key" is the 2026-07-12 bug that made every multi-select render "—".
function fieldValue(occ, fieldId) {
  if (!fieldId) return undefined;
  const raw = occ?.fields?.[fieldId];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return "value" in raw ? raw.value : undefined;
  return raw;
}

function labelOf(occ, ctx) {
  return occ?.label || ctx?.modulesById?.[occ?.moduleId]?.label || "";
}

/**
 * @returns {{ nodes: Array, warnings: Array }}
 *   node = { id, occurrenceId|null, name, value, series, children[], depth }
 *   warning = { occurrenceId, why }
 */
export function buildGraphData(graphOcc, ctx) {
  const spec = graphSpec(graphOcc);
  const warnings = [];
  if (!spec) return { nodes: [], warnings };

  const encoding = spec.encoding && typeof spec.encoding === "object" ? spec.encoding : {};
  const { category = null, value = null, series = null, parent = null, level = null } = encoding;
  const nest = encoding.children === "occurrences";
  const occurrencesById = ctx?.occurrencesById || {};

  // PARENT-FIELD MODE: the rows are a FLAT list and each one names its parent in
  // a field. Build a child index once, then walk from the roots — the rows that
  // name no parent, or name one that is not on this graph.
  //
  // A parent value may be a bare id or a one-element array, because an
  // occurrence dropdown stores either depending on whether it is multi-select.
  const parentOf = (occ) => {
    const raw = fieldValue(occ, parent);
    const id = Array.isArray(raw) ? raw[0] : raw;
    return typeof id === "string" && id ? id : null;
  };

  // A row with no value field is a TALLY (count 1), not a hole. A row whose
  // value field is present but unreadable is a 0 PLUS a warning — the caller
  // can surface "this row contributed nothing" without the chart showing NaN.
  const valueFor = (occ) => {
    if (!value) return 1;
    const raw = fieldValue(occ, value);
    if (raw == null || raw === "") {
      warnings.push({ occurrenceId: occ.id, why: "no value for the configured field" });
      return 0;
    }
    const n = Number(raw);
    if (Number.isNaN(n)) {
      warnings.push({ occurrenceId: occ.id, why: `value is not numeric: ${String(raw).slice(0, 24)}` });
      return 0;
    }
    return n;
  };

  const memberIds = Array.isArray(graphOcc.occurrences) ? graphOcc.occurrences : [];

  // Child index for parent-field mode, built once rather than scanned per node.
  const kidsOf = new Map();
  if (parent) {
    const onGraph = new Set(memberIds);
    for (const id of memberIds) {
      const occ = occurrencesById[id];
      if (!occ) continue;
      const p = parentOf(occ);
      // A parent that is not itself on this graph makes the row a ROOT — that is
      // what lets a graph show one branch of a bigger board without its rows
      // silently vanishing under an absent parent.
      if (p && p !== id && onGraph.has(p)) {
        if (!kidsOf.has(p)) kidsOf.set(p, []);
        kidsOf.get(p).push(id);
      }
    }
  }

  const seen = new Set();

  const build = (occId, depth) => {
    const occ = occurrencesById[occId];
    if (!occ) {
      warnings.push({ occurrenceId: occId, why: "child id resolves to no occurrence" });
      return null;
    }
    // Cycle guard: an occurrence can legitimately be multi-parented, and a
    // parent FIELD can be edited into a loop by hand, so a tree walk must never
    // assume it is a tree.
    if (seen.has(occId) || depth > MAX_DEPTH) return null;
    seen.add(occId);

    const childIds = parent
      ? (kidsOf.get(occId) || [])
      : (nest && Array.isArray(occ.occurrences) ? occ.occurrences : []);
    const children = childIds.map((cid) => build(cid, depth + 1)).filter(Boolean);

    const nameFromField = category ? fieldValue(occ, category) : null;
    return {
      id: occ.id,
      occurrenceId: occ.id,
      name: (nameFromField ?? null) != null && nameFromField !== "" ? String(nameFromField) : labelOf(occ, ctx),
      // A parent in a nested chart is sized by its children; only ask for a
      // value where there is nothing underneath.
      value: children.length ? undefined : valueFor(occ),
      series: series ? (fieldValue(occ, series) ?? null) : null,
      // The row's own declared ring, when a level field is configured. Reported
      // rather than used: `depth` is derived from the tree and is what a chart
      // renders, so a level field is for validation and for editors — a
      // disagreement between the two is a data problem worth being able to see.
      level: level ? (fieldValue(occ, level) ?? null) : null,
      children,
      depth,
    };
  };

  // In parent-field mode only the ROOTS are walked; children are reached through
  // the index, so a flat member list still yields a tree.
  const rootIds = parent
    ? memberIds.filter((id) => {
        const occ = occurrencesById[id];
        if (!occ) return true;               // let build() report it as missing
        const p = parentOf(occ);
        return !p || p === id || !memberIds.includes(p);
      })
    : memberIds;

  const nodes = rootIds.map((cid) => build(cid, 0)).filter(Boolean);

  // A parent-field graph whose rows ALL name a parent is a cycle or a broken
  // config; surface it rather than rendering an empty chart with no explanation.
  if (parent && memberIds.length > 0 && rootIds.length === 0) {
    warnings.push({ occurrenceId: null, why: "every row names a parent — no root to draw from" });
  }

  // Hardcoded values, appended after the real rows. `occurrenceId: null` is how
  // a click handler knows there is nothing to open.
  const literals = Array.isArray(spec.literals) ? spec.literals : [];
  for (const [i, lit] of literals.entries()) {
    if (!lit || typeof lit !== "object") continue;
    const n = Number(lit.value);
    nodes.push({
      id: `literal-${i}`,
      occurrenceId: null,
      name: String(lit.name ?? ""),
      value: Number.isNaN(n) ? 0 : n,
      series: lit.series ?? null,
      children: [],
      depth: 0,
    });
  }

  return { nodes, warnings };
}
