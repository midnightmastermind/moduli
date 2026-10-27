// 0449 — `Schedule: Clear Date on Move-Out` clears a row's Date and Time Slot
// only when the row LEFT the Schedule (user, 2026-10-27: "when i move the
// original to done … it deletes the date currently. it shouldnt do that").
//
// It cleared whenever the moved row ended up outside the Schedule. That was
// harmless while appointments lived in Schedule slots; since 0447/0448 the
// originals live in Tasks, so moving one from Appointments to Done wiped its
// date. Now the container it came FROM (`$trigger.fromContainerId`, an
// occurrence id) must be under the Schedule page as well.
export const id = "0449-clear-date-only-when-leaving-schedule";
export const describe = "Clear Date on Move-Out fires only for a row moved out of the Schedule, not between Tasks containers.";
export const touches = ["operations"];

const OP_NAME = "Schedule: Clear Date on Move-Out";

/** Pure: add the from-container lookup and the "came from the Schedule" rule. */
export function onlyWhenLeaving(pipeline) {
  const steps = pipeline?.steps || [];
  if (JSON.stringify(steps).includes("$fromCont")) return { pipeline, changed: false };
  const findAt = steps.findIndex((s) => s.type === "action" && s.config?.type === "FIND" && s.config.itemVar === "$movedItem");
  const gateAt = steps.findIndex((s) => s.type === "if"
    && (s.condition?.rules || []).some((r) => r.left === "$movedItem._ancestors" && r.comparator === "NOT_HAS_ANCESTOR"));
  if (findAt === -1 || gateAt === -1 || gateAt < findAt) return { pipeline, changed: false };
  const findFrom = { id: "mo0449find", type: "action", config: { type: "FIND",
    predicate: { operator: "AND", rules: [{ id: "mo0449r1", left: "id", comparator: "IS", right: "$trigger.fromContainerId" }] },
    itemVar: "$fromCont" } };
  const next = steps.slice();
  const gate = next[gateAt];
  next[gateAt] = { ...gate, condition: { ...gate.condition, rules: [
    ...gate.condition.rules,
    { id: "mo0449r2", left: "$fromCont._ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" },
  ] } };
  next.splice(findAt + 1, 0, findFrom);
  return { pipeline: { ...pipeline, steps: next }, changed: true };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const op = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  if (!op) { log(`  "${OP_NAME}" not on this grid — skipped`); return; }
  const { pipeline, changed } = onlyWhenLeaving(op.pipeline);
  if (!changed) {
    if (JSON.stringify(op.pipeline).includes("$fromCont")) { log("  already applied"); return; }
    throw new Error("the op does not have the expected shape — nothing written");
  }
  log("  adds FIND $fromCont + rule: $fromCont._ancestors HAS_ANCESTOR $schedPageId");
  if (dryRun) return;
  await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
  const after = await Operation.findOne({ gridId, id: op.id }).lean();
  if (!JSON.stringify(after.pipeline).includes("$fromCont._ancestors")) throw new Error("read-back does not show the rule");
  log("  applied. RESTART pm2.");
}
