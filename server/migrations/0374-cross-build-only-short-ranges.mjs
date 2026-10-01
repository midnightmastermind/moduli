// 0374 — the Schedule and the Day Page build each other's missing day only for
// ranges of 7 days or fewer.
//
// 0372 made each builder also build the OTHER side's missing day. On
// 2026-10-01 04:19 UTC one load with a 14-day range built 14 day page columns
// plus Schedule columns at 49 slots each — ~700 rows in one burst — and six
// Schedule columns reached Mongo without their modules (swept, backup
// server/backups/orphans/2026-10-01-broken-schedule-cols.json). The Schedule
// itself already treats 7 days as the limit for full slots
// ($activePeriodCount <= 7); the cross-build now follows the same line. Each
// side still builds ITS OWN days at any range.
//
// Wraps exactly the steps 0372 added (ids x-page-missing / x-sched-missing) in
// `if $activePeriodCount <= 7`. Idempotent.

export const id = "0374-cross-build-only-short-ranges";
export const describe = "Schedule <-> Day Page cross-building (0372) runs only when 7 or fewer days are shown.";
export const touches = ["operations"];

const GUARD_ID = "x-short-range";
const CROSS_IDS = new Set(["x-page-missing", "x-sched-missing"]);

/** Pure: wrap each cross-build `if` in a ≤7-day guard. */
export function guardCrossBuild(pipeline) {
  const clone = JSON.parse(JSON.stringify(pipeline || {}));
  let changed = 0, already = 0;
  const walk = (steps) => {
    if (!Array.isArray(steps)) return;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s?.id === GUARD_ID) { already++; continue; }
      if (CROSS_IDS.has(s?.id)) {
        steps[i] = { id: GUARD_ID, type: "if",
          condition: { operator: "AND", rules: [{ id: `${GUARD_ID}-r`, left: "$activePeriodCount", comparator: "LESS_OR_EQUAL", right: 7 }] },
          then: [s], else: [] };
        changed++;
        continue;
      }
      for (const k of ["then", "else", "body", "steps"]) walk(s?.[k]);
    }
  };
  walk(clone.steps);
  return { pipeline: clone, changed, already };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  for (const name of ["Schedule: Build Schedule", "Day Page: Build"]) {
    const op = await Operation.findOne({ gridId, name }).lean();
    if (!op) { log(`no "${name}" — skipped.`); continue; }
    const { pipeline, changed, already } = guardCrossBuild(op.pipeline);
    if (!changed) { log(`${name}: ${already ? "already guarded" : "no cross-build step found"}.`); continue; }
    log(`${name}: guarded ${changed} cross-build step(s).`);
    if (dryRun) continue;
    await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
    const after = await Operation.findOne({ gridId, id: op.id }).lean();
    if (guardCrossBuild(after.pipeline).changed) throw new Error(`readback: ${name} not guarded`);
  }
}
