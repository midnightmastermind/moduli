// helpers/graphWarnings.js — what a chart could not draw, said once.
//
// A chart has TWO layers that can each discard something, and they report in
// different shapes:
//
//   buildGraphData   {occurrenceId, why}   a ROW contributed nothing
//   buildEChartsOption  "…" (string)       the TYPE ignored an encoding, a
//                                          level of the hierarchy was flattened
//                                          away, or two rows shared a name and
//                                          only the first was drawn
//
// `GraphSection` (the editor) already merged both, with the reason written in
// its own comment: "BOTH HALVES WARN, and the readout is worthless if it only
// hears one … those are precisely the failures that still LOOK like a chart."
//
// THE CHART ITSELF HEARD ONLY ONE. `ContainerGraph` destructured `option` from
// `buildEChartsOption` and dropped its `warnings` on the floor, so the surface
// the user is actually looking at could report a row that contributed nothing
// and NOT that a row had been silently dropped. Measured on prod 2026-09-22: a
// bar chart over 3 rows (2 "meal", 1 "ingredient") drew meal = 1 — the second
// meal row discarded — with no warning anywhere on the chart.
//
// So the merge lives here and both surfaces call it: two copies of "normalise
// the other layer's shape" is exactly how one of them drifts back to silence.

/**
 * One list, one shape.
 * @param {Array<{occurrenceId?:string|null, why:string}>} dataWarnings
 * @param {Array<string|{why:string}>} drawWarnings
 */
export function mergeGraphWarnings(dataWarnings = [], drawWarnings = []) {
  return [
    ...(Array.isArray(dataWarnings) ? dataWarnings : []),
    ...(Array.isArray(drawWarnings) ? drawWarnings : []).map((w) =>
      typeof w === "string" ? { occurrenceId: null, why: w } : w,
    ),
  ].filter(Boolean);
}

/**
 * The one-line badge. A row that contributed nothing and a chart that ignored
 * an encoding are different complaints, so counting them together under "N rows"
 * would be a lie the moment a non-row warning appears — which is the whole class
 * this merge exists to surface.
 */
export function summariseGraphWarnings(merged = []) {
  const rows = merged.filter((w) => w && w.occurrenceId).length;
  const chart = merged.length - rows;
  const parts = [];
  if (rows) parts.push(`${rows} row${rows === 1 ? "" : "s"} contributed nothing`);
  if (chart) parts.push(`${chart} chart issue${chart === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
