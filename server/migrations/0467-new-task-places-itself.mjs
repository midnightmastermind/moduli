// 0467 — "New task" runs Schedule: Place Dated Work right after it creates the task (user, 2026-10-31: "i just
// created a task todo and it didnt add it to the schedule todo until i reloaded"). 0465 gave Place Dated Work an
// onAdd trigger under Tasks › Todo, but a row an OPERATION creates fires no add trigger (that is what keeps ops from
// cascading), and the New task button is an operation — so its task waited for the next load. The button's own
// operation now calls the placing operation, the same way Build Schedule calls Completed Tasks.
export const id = "0467-new-task-places-itself";
export const describe = "New task runs Schedule: Place Dated Work after creating the task.";
export const touches = ["operations"];

const CALLER = "New task";
const CALLEE = "Schedule: Place Dated Work";
const STEP_ID = "newTaskPlaces";

/** Pure. Inserts a RUN_OPERATION of `calleeId` right after the pipeline's one top-level CREATE. */
export function runPlacingAfterCreate(pipeline, calleeId) {
  const steps = pipeline?.steps || [];
  if (steps.some((s) => s?.id === STEP_ID)) return { pipeline, changed: 0 };
  const creates = steps.map((s, i) => (s?.config?.type === "CREATE" ? i : -1)).filter((i) => i >= 0);
  if (creates.length !== 1) throw new Error(`expected exactly 1 top-level CREATE, found ${creates.length}`);
  const at = creates[0] + 1;
  const step = { id: STEP_ID, type: "action", config: { type: "RUN_OPERATION", operationId: calleeId } };
  return { pipeline: { ...pipeline, steps: [...steps.slice(0, at), step, ...steps.slice(at)] }, changed: 1 };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const caller = await Operation.findOne({ gridId, name: CALLER }).lean();
  const callee = await Operation.findOne({ gridId, name: CALLEE }).lean();
  if (!caller || !callee) { log(`  missing "${!caller ? CALLER : CALLEE}" — nothing to do`); return; }
  const { pipeline, changed } = runPlacingAfterCreate(caller.pipeline, callee.id);
  log(`  ${CALLER}: ${changed ? `runs "${CALLEE}" after its Create` : "already done"}`);
  if (!dryRun && changed) {
    await Operation.updateOne({ gridId, id: caller.id }, { $set: { pipeline, updatedAt: new Date() } });
    log("  applied. RESTART pm2.");
  }
}
