// User, 2026-08-01: "make the daypages wider and give the daily question a
// marquee".
//
//   * Column width is now a cascade rule (`childMinWidth` / `childMaxWidth`)
//     rather than the renderer's hardcoded 280/360, so widening the Day Page
//     does NOT also widen the Schedule — and the width is settable from the
//     page header's Layout menu afterwards.
//   * The Daily Question header gets `labelOverflow: "marquee"`. Bound headers
//     truncate by default (2026-07-31: "a control is not prose"), but the
//     question IS prose — reading it is the entire point and it rarely fits a
//     column, so this one scrolls.

export const id = "0028-day-page-width-and-question-marquee";
export const describe =
  "Widens the Day Page columns via the layout cascade (420-560 instead of the renderer's 280-360 default) " +
  "and makes the Daily Question header marquee so a long question can be read in full.";

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence } = models;

  // ── wider columns ─────────────────────────────────────────────────────────
  const boardMod = await Module.findOne({ gridId, role: "page", kind: "board", label: "Day Page" })
    .select({ id: 1 }).lean();
  const boardOcc = boardMod
    ? await Occurrence.findOne({ gridId, moduleId: boardMod.id }).select({ id: 1, meta: 1 }).lean()
    : null;
  if (!boardOcc) { log("no Day Page board on this grid"); }
  else {
    const cascade = { ...(boardOcc.meta?.layoutCascade || {}), childMinWidth: 420, childMaxWidth: 560 };
    log(`Day Page columns → ${cascade.childMinWidth}-${cascade.childMaxWidth}px wide`);
    if (!dryRun) {
      await Occurrence.updateOne({ gridId, id: boardOcc.id }, {
        $set: { meta: { ...(boardOcc.meta || {}), layoutCascade: cascade } },
      });
    }
  }

  // ── the question marquees ─────────────────────────────────────────────────
  const qMods = await Module.find({ gridId, role: "container", label: "Daily Question" })
    .select({ id: 1, meta: 1 }).lean();
  let marqueed = 0;
  for (const m of qMods) {
    if (m.meta?.labelOverflow === "marquee") continue;
    marqueed++;
    if (!dryRun) await Module.updateOne({ gridId, id: m.id }, { $set: { "meta.labelOverflow": "marquee" } });
  }
  log(`${marqueed} Daily Question header(s) set to marquee (of ${qMods.length})`);
}
