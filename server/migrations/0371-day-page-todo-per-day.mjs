// 0371 — a day page column embeds THAT day's Todo, or none.
//
// User, 2026-09-30: *"i just made a new daypage container (navigated to show
// both today and tomorrow), and in the todo section, Birthday - Laura Mostowik
// shows up on both. it should just show up for day of the birthday"*.
//
// `Day Page: Build` loops over the dates on screen. Per date it FINDs that
// day's Schedule column, and — only when there is one — FINDs its Todo into
// `$todoId`. The step that embeds the Todo sits OUTSIDE that `if`. Tomorrow
// has no Schedule column yet, so the Todo FIND never ran and `$todoId` still
// held TODAY's — and tomorrow's column embedded today's Todo, birthday card
// and all. (FIND itself does clear its var on no match; the FIND just never
// ran.)
//
// The fix is one step: reset `$todoId` at the top of each iteration, before
// the Schedule-column FIND. A day with no Schedule column then embeds no Todo.
// Idempotent — a second run finds the reset already there.

export const id = "0371-day-page-todo-per-day";
export const describe = "Day Page: Build resets $todoId for each date, so a day with no Schedule column no longer embeds the previous day's Todo.";
export const touches = ["operations"];

const OP_NAME = "Day Page: Build";
const RESET_ID = "reset-todoId-per-day";

const findsDayColumn = (s) => s?.type === "action" && s.config?.type === "FIND" && s.config.itemIdVar === "$dayColId";

/** Pure: returns { pipeline, changed, reason }. */
export function resetTodoPerDay(pipeline) {
  const clone = JSON.parse(JSON.stringify(pipeline || {}));
  let changed = false;
  let reason = "no FIND binding $dayColId found";
  const walk = (steps) => {
    if (!Array.isArray(steps) || changed) return;
    const at = steps.findIndex(findsDayColumn);
    if (at >= 0) {
      if (steps.some((t) => t?.id === RESET_ID)) { reason = "already resets $todoId per day"; return; }
      steps.splice(at, 0, { id: RESET_ID, type: "action", config: { type: "INIT_VAR", name: "$todoId", expr: "literal:" } });
      changed = true;
      reason = "inserted INIT_VAR $todoId = \"\" before the Schedule-column FIND";
      return;
    }
    for (const s of steps) for (const k of ["body", "steps", "then", "else"]) if (Array.isArray(s?.[k])) walk(s[k]);
  };
  walk(clone.steps);
  return { pipeline: clone, changed, reason };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const op = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  if (!op) { log(`no "${OP_NAME}" op on this grid — nothing to do.`); return; }
  const { pipeline, changed, reason } = resetTodoPerDay(op.pipeline);
  if (!changed) { log(`unchanged: ${reason}.`); return; }
  log(`${OP_NAME} (${op.id}): ${reason}.`);
  if (dryRun) return;
  await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
  const after = await Operation.findOne({ gridId, id: op.id }).lean();
  if (resetTodoPerDay(after.pipeline).reason !== "already resets $todoId per day") {
    throw new Error("readback: the $todoId reset is not in the pipeline");
  }
  log("applied and read back.");
}
