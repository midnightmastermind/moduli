/**
 * 0138 — the feeling wheel's third ring reads at rest, and its tooltip stops
 * printing a count.
 *
 * USER, 2026-08-18: "the emotions wheel still starts out with nothing written in
 * the third level (its written, the writing is just transparent and only shows
 * on hover)" … "if i zoom in, the writing comes back" … "dont show the number on
 * the graph hover (it says like Trust 8) … thats the number saying how many
 * third level children it has, we dont need that number."
 *
 * WHAT IT WAS NOT, checked before changing anything: our own label threshold.
 * This graph already stores `labelMinArcPx: 8`, and the real function returns
 * 3.16deg at the box the wheel renders in — comfortably under the 4.5deg slice,
 * so it was passing. The client carries that 8 too, not just the database.
 *
 * WHAT IT IS: ECharts' own fit test. The outer ring is 80 slices of a FIXED
 * 4.5deg (9 primary / 40 secondary / 80 tertiary — counted, not assumed), and at
 * a 315px box that is about 9.5px of ARC against a 9px label. There is no room,
 * so ECharts draws none of them; hovering shows one because emphasis draws its
 * label regardless of fit. Zooming grows the radius, the arc grows with it, and
 * the ring comes back — exactly what the user described.
 *
 * The arc is fixed by the data and the box by the layout, so THE FONT IS THE
 * ONLY INPUT LEFT. 7px clears the 9.5px arc with room to spare. It is stored per
 * graph rather than changed globally because it is a fact about THIS wheel —
 * 80 leaves in a small box — not about sunbursts.
 *
 * `hideTooltipValue` drops the number. On a nested chart with no value encoding
 * that number is a child COUNT ECharts derived; on a wheel for picking a feeling
 * "Trust 8" reads as data about Trust and is simply wrong.
 *
 * Both are additive keys on `meta.graph`, merged rather than written whole —
 * that map also carries the encoding, the day field and the selection field, and
 * a whole-object write is how those get dropped.
 */
export const id = "0138-wheel-outer-ring-labels";
export const describe =
  "Feeling wheel: smaller label font so the third ring reads at rest, and no derived count in its tooltip.";

export const LABEL_FONT_PX = 7;

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence } = models;
  const graphs = await Occurrence.find({ gridId, "meta.graph": { $exists: true } }).lean();
  if (!graphs.length) { log("  no graph occurrences on this grid"); return; }

  // STRUCTURAL, not by label: a wheel is a SUNBURST that draws a hierarchy.
  // "Emotions Wheel" is one rename away from wrong, and the reason the ring is
  // unreadable is the shape of the data, not its name.
  const targets = graphs.filter(g => g.meta.graph?.type === "sunburst");
  log(`  graph occurrences: ${graphs.length} · sunbursts: ${targets.length}`);

  for (const g of targets) {
    const spec = g.meta.graph;
    const already = spec.labelFontPx === LABEL_FONT_PX && spec.hideTooltipValue === true;
    log(`    ${g.id} · labelFontPx ${spec.labelFontPx ?? "(default)"} -> ${LABEL_FONT_PX} · hideTooltipValue ${spec.hideTooltipValue ?? false} -> true${already ? "  (already set)" : ""}`);
  }
  if (dryRun) { log("  DRY RUN — nothing written"); return; }

  for (const g of targets) {
    await Occurrence.updateOne(
      { id: g.id, gridId },
      { $set: { "meta.graph.labelFontPx": LABEL_FONT_PX, "meta.graph.hideTooltipValue": true } },
    );
  }

  // Read back — and check the REST of the spec survived, because the failure
  // this guards against is a merge that silently became a replace.
  const after = await Occurrence.find({ gridId, "meta.graph": { $exists: true } }).lean();
  let bad = 0;
  for (const g of targets) {
    const now = after.find(x => x.id === g.id)?.meta?.graph || {};
    const ok = now.labelFontPx === LABEL_FONT_PX && now.hideTooltipValue === true
      && JSON.stringify(now.encoding) === JSON.stringify(g.meta.graph.encoding);
    if (!ok) bad++;
    log(`    verify ${g.id}: font+tooltip set and encoding intact -> ${ok ? "YES" : "NO"}`);
  }
  if (bad) throw new Error(`${bad} graph(s) did not persist correctly`);
}
