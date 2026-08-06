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
//       children: "occurrences",    // nest by the occurrence tree (sunburst/treemap)
//     },
//     literals: [{ name, value }],
//   }
//
// Nesting by the occurrence tree is what makes a feeling wheel possible with no
// graph-specific code: the emotion hierarchy is just occurrences in containers,
// and the wheel's rings are that tree's depth.
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
  const { category = null, value = null, series = null } = encoding;
  const nest = encoding.children === "occurrences";
  const occurrencesById = ctx?.occurrencesById || {};

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

  const seen = new Set();

  const build = (occId, depth) => {
    const occ = occurrencesById[occId];
    if (!occ) {
      warnings.push({ occurrenceId: occId, why: "child id resolves to no occurrence" });
      return null;
    }
    // Cycle guard: an occurrence can legitimately be multi-parented, so a tree
    // walk must not assume it is a tree.
    if (seen.has(occId) || depth > MAX_DEPTH) return null;
    seen.add(occId);

    const children = (nest && Array.isArray(occ.occurrences))
      ? occ.occurrences.map((cid) => build(cid, depth + 1)).filter(Boolean)
      : [];

    const nameFromField = category ? fieldValue(occ, category) : null;
    return {
      id: occ.id,
      occurrenceId: occ.id,
      name: (nameFromField ?? null) != null && nameFromField !== "" ? String(nameFromField) : labelOf(occ, ctx),
      // A parent in a nested chart is sized by its children; only ask for a
      // value where there is nothing underneath.
      value: children.length ? undefined : valueFor(occ),
      series: series ? (fieldValue(occ, series) ?? null) : null,
      children,
      depth,
    };
  };

  const nodes = (Array.isArray(graphOcc.occurrences) ? graphOcc.occurrences : [])
    .map((cid) => build(cid, 0))
    .filter(Boolean);

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
