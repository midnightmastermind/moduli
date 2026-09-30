// 0372 — the Schedule and the Day Page each build the other's missing day.
//
// User, 2026-09-30: *"tomorrows daypage doesnt even show a todo container"* →
// (asked) *"lets go for 1 and vice versa, schedule should create a daypage as
// well"*. A day page's Todo IS that day's Schedule column's Todo slot, and a
// Schedule column exists only once the Schedule has shown that date — so a day
// page for a date the Schedule never showed had no Todo at all.
//
// Each build's PER-DATE BODY moves, unchanged, into its own op that takes the
// date as an argument (RUN_OPERATION `vars`, added the same day):
//
//   Schedule: Build Day   — the INIT_VARs of Build Schedule + its loop body
//   Day Page: Build Day   — the INIT_VARs of Day Page: Build + its loop body
//
// and each builder's loop becomes:
//
//   Schedule: Build Schedule   RUN "Schedule: Build Day"($day)
//                              FIND the day page column for $day
//                              if none → RUN "Day Page: Build Day"($day)
//   Day Page: Build            FIND the Schedule column for $day
//                              if none → RUN "Schedule: Build Day"($day)
//                              RUN "Day Page: Build Day"($day)
//
// The two FINDs are the bodies' OWN first FINDs, copied, so "is there a column
// for this date" is asked exactly as each build asks it. The Build Day ops have
// no triggers — they run only when called — and never call each other, so there
// is no recursion. Nothing is deleted; the builders' gates, layout steps and
// tails (Water, Completed Tasks) are untouched.
//
// Idempotent: an existing Build Day op is left as it is, and a loop that already
// calls it is not rewritten.

export const id = "0372-schedule-and-day-page-build-each-other";
export const describe = "Moves each builder's per-date body into 'Schedule: Build Day' / 'Day Page: Build Day' (new, trigger-less) and has each builder also build the OTHER side's missing day. Deletes nothing.";
export const touches = ["operations"];

export const SCHED = { builder: "Schedule: Build Schedule", day: "Schedule: Build Day" };
export const PAGE = { builder: "Day Page: Build", day: "Day Page: Build Day" };

const perDateLoop = (steps) => {
  let hit = null;
  const walk = (st) => { for (const s of st || []) { if (hit) return; if (s?.type === "loop" && s.overExpr === "$activePeriodDates") { hit = s; return; } for (const k of ["then", "else", "body", "steps"]) walk(s?.[k]); } };
  walk(steps);
  return hit;
};
const topInitVars = (steps) => {
  const out = [];
  for (const s of steps || []) { if (s?.type === "action" && s.config?.type === "INIT_VAR") out.push(s); else break; }
  return out;
};
const calls = (steps, name) => JSON.stringify(steps || []).includes(`"operationName":"${name}"`);

/** The first FIND of a per-date body — how that build asks "is there a column for $day?". */
export function columnFind(pipeline, varName) {
  const loop = perDateLoop(pipeline?.steps);
  const f = (loop?.body || []).find((s) => s?.config?.type === "FIND");
  if (!f) throw new Error("per-date loop has no leading FIND");
  return { ...JSON.parse(JSON.stringify(f)), id: `${f.id}-probe`, config: { ...JSON.parse(JSON.stringify(f.config)), itemIdVar: varName, itemVar: undefined } };
}

/** Pure: a trigger-less op running `pipeline`'s per-date body for a given $day. */
export function buildDayPipeline(pipeline) {
  const loop = perDateLoop(pipeline?.steps);
  if (!loop) throw new Error("no loop over $activePeriodDates");
  return {
    sources: JSON.parse(JSON.stringify(pipeline.sources || [])),
    steps: [
      ...JSON.parse(JSON.stringify(topInitVars(pipeline.steps))),
      { id: "has-day", type: "if",
        condition: { operator: "AND", rules: [{ id: "has-day-r", left: "$day", comparator: "IS_NOT_EMPTY", right: "" }] },
        then: JSON.parse(JSON.stringify(loop.body)), else: [] },
    ],
  };
}

const run = (id, name) => ({ id, type: "action", config: { type: "RUN_OPERATION", operationName: name, vars: { $day: "$day" } } });
const ifEmpty = (id, v, then) => ({ id, type: "if",
  condition: { operator: "AND", rules: [{ id: `${id}-r`, left: v, comparator: "IS_EMPTY", right: "" }] }, then, else: [] });

/** Pure: Build Schedule's loop body → own day + the day page's missing day. */
export function rewireSchedule(schedPipeline, pagePipeline) {
  const clone = JSON.parse(JSON.stringify(schedPipeline));
  const loop = perDateLoop(clone.steps);
  if (calls(loop.body, SCHED.day)) return { pipeline: clone, changed: false };
  loop.body = [
    run("x-sched-day", SCHED.day),
    columnFind(pagePipeline, "$crossPageColId"),
    ifEmpty("x-page-missing", "$crossPageColId", [run("x-page-day", PAGE.day)]),
  ];
  return { pipeline: clone, changed: true };
}

/** Pure: Day Page: Build's loop body → the schedule's missing day + own day. */
export function rewirePage(pagePipeline, schedPipeline) {
  const clone = JSON.parse(JSON.stringify(pagePipeline));
  const loop = perDateLoop(clone.steps);
  if (calls(loop.body, PAGE.day)) return { pipeline: clone, changed: false };
  loop.body = [
    columnFind(schedPipeline, "$crossSchedColId"),
    ifEmpty("x-sched-missing", "$crossSchedColId", [run("x-sched-day", SCHED.day)]),
    run("x-page-day", PAGE.day),
  ];
  return { pipeline: clone, changed: true };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const sched = await Operation.findOne({ gridId, name: SCHED.builder }).lean();
  const page = await Operation.findOne({ gridId, name: PAGE.builder }).lean();
  if (!sched || !page) { log("this grid does not have both builders — nothing to do."); return; }

  // The Build Day ops are cut from the builders AS THEY ARE NOW, before either
  // loop is rewired — reading them after would copy a body of RUN_OPERATIONs.
  const already = calls(perDateLoop(sched.pipeline.steps)?.body, SCHED.day);
  const plan = [];
  for (const [src, name] of [[sched, SCHED.day], [page, PAGE.day]]) {
    if (await Operation.findOne({ gridId, name }).lean()) { log(`"${name}" exists — kept.`); continue; }
    if (already) throw new Error(`"${name}" is missing but the builders are already rewired — restore from backup`);
    plan.push({ name, pipeline: buildDayPipeline(src.pipeline), from: src });
  }
  const s2 = rewireSchedule(sched.pipeline, page.pipeline);
  const p2 = rewirePage(page.pipeline, sched.pipeline);
  log(`create: ${plan.map((p) => p.name).join(", ") || "none"}; rewire: ${[s2.changed && SCHED.builder, p2.changed && PAGE.builder].filter(Boolean).join(", ") || "none"}.`);
  if (dryRun) return;

  for (const p of plan) {
    const { _id, id: _oldId, name: _n, triggerObjects: _t, triggerTypes: _tt, createdAt: _c, updatedAt: _u, ...rest } = p.from;
    await Operation.create({ ...rest, id: `op-${Math.random().toString(36).slice(2, 12)}`, name: p.name,
      pipeline: p.pipeline, triggerTypes: [], triggerObjects: [], enabled: true });
  }
  if (s2.changed) await Operation.updateOne({ gridId, id: sched.id }, { $set: { pipeline: s2.pipeline } });
  if (p2.changed) await Operation.updateOne({ gridId, id: page.id }, { $set: { pipeline: p2.pipeline } });

  for (const name of [SCHED.day, PAGE.day]) {
    const op = await Operation.findOne({ gridId, name }).lean();
    if (!op || (op.triggerTypes || []).length) throw new Error(`readback: "${name}" missing or has triggers`);
  }
  const s3 = await Operation.findOne({ gridId, id: sched.id }).lean();
  const p3 = await Operation.findOne({ gridId, id: page.id }).lean();
  if (!calls(perDateLoop(s3.pipeline.steps).body, SCHED.day) || !calls(perDateLoop(p3.pipeline.steps).body, PAGE.day)) {
    throw new Error("readback: a builder's loop was not rewired");
  }
  log("applied and read back.");
}
