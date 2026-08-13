// server/migrations/0090-wheel-shows-its-outer-labels.mjs
//
// User, 2026-08-12: "the third level parts of the graph are not showing up" /
// "i still cant see the third levels text in the graph" / "just make the graph
// smaller, it doesnt need to be so big."
//
// THOSE TWO ASKS FIGHT EACH OTHER UNLESS THE THRESHOLD MOVES, which is the whole
// reason this exists. The ring is drawn — buildGraphData returns depths
// {0:8, 1:40, 2:80} with zero warnings over live data — but its TEXT is
// suppressed by the arc-length threshold, and a SMALLER chart has a shorter arc,
// so shrinking it would hide the labels harder.
//
// THE DEFAULT WAS ON A CLIFF. For an 80-leaf ring (4.5° a slice) to keep labels:
//
//   multiplier 1.8  -> needs a 498px box   (the 2026-08-06 blanked ring)
//   multiplier 1.5  -> needs a 415px box   <- a day column is 420px WIDE
//   at 8px          -> needs a 222px box
//
// The box is min(width, height) and a wheel in a day column is routinely shorter
// than it is wide, so at the default the ring lost its text over a few pixels.
// The previous entry called 1.8 "4.9% from a cliff" and replaced it with
// something 1.2% from the same cliff.
//
// THE GLOBAL DEFAULT IS NOT WHAT MOVED, and a test is why: lowering it re-showed
// all 80 labels on a 390px phone — the collision the threshold exists to prevent
// — and graphOption.test.js failed on exactly that case. So the value lands on
// THIS wheel, as data the renderer already reads. How dense a wheel may be is a
// property of that wheel, not a constant every chart on the grid must share.
export const id = "0090-wheel-shows-its-outer-labels";
export const describe =
  "The emotions wheel keeps its outer-ring labels even at the smaller chart size.";

export const LABEL_MIN_ARC_PX = 8;

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const graphs = occs.filter((o) => modById.get(o.moduleId)?.kind === "graph");
  if (graphs.length !== 1) {
    log(`REFUSING: expected exactly 1 graph occurrence, found ${graphs.length} — nothing written.`);
    return;
  }
  const graph = graphs[0];
  const current = graph.meta?.graph?.labelMinArcPx;
  log(`wheel ${graph.id.slice(0, 8)} · labelMinArcPx ${current ?? "(default 15)"} -> ${LABEL_MIN_ARC_PX}`);
  log(`  at 8px an 80-leaf ring keeps its labels from a ~222px box up (the default needed ~415px)`);

  if (dryRun) {
    log(`WOULD set meta.graph.labelMinArcPx = ${LABEL_MIN_ARC_PX}.`);
    return;
  }
  await Occurrence.updateOne(
    { gridId, id: graph.id },
    { $set: { meta: { ...(graph.meta || {}),
      graph: { ...(graph.meta?.graph || {}), labelMinArcPx: LABEL_MIN_ARC_PX } } } }
  );
  log(`the wheel keeps its outer-ring labels at the smaller size.`);
}
