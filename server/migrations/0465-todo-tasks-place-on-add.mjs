// 0465 — a task put into Tasks › Todo reaches the Schedule's Todo at once (user, 2026-10-31: "why new ones dont get
// added" · "if a task ends up in todo it should auto add it to the one in schedule"). `Schedule: Place Dated Work`
// copy-links every undated Tasks › Todo row into each shown day's Todo (0453), but it ran only on load, a date change
// and edits to Date / Time Slot / Due / Completed On — adding, dragging in or dragging out a task changed nothing until
// the next reload. Three triggers, at the op's own priority:
//   onAdd instance, under Tasks › Todo        a task created there
//   onMove instance, under Tasks › Todo       a task dragged in (a move's ancestors are where it lands)
//   onMove from the Tasks › Todo container    a task dragged out (the op's sweep removes its copy)
// The Todo container is the one the op itself names in its pipeline, so the triggers cannot point elsewhere.
export const id = "0465-todo-tasks-place-on-add";
export const describe = "Place Dated Work re-runs when a task is added to, moved into or moved out of Tasks › Todo.";
export const touches = ["operations"];

const OP_NAME = "Schedule: Place Dated Work";

/** The Tasks › Todo container id the pipeline compares `$ut.parentId` with. */
export function todoContainerIdOf(pipeline) {
  const m = /"left":"\$ut\.parentId","comparator":"IS","right":"([^"$][^"]*)"/.exec(JSON.stringify(pipeline || {}));
  return m ? m[1] : null;
}

/** The trigger list with the three added (each only once). Pure. */
export function withTodoTriggers(triggers, todoId, priority = 2) {
  const list = Array.isArray(triggers) ? [...triggers] : [];
  const wanted = [
    { eventType: "onAdd", subjectType: "module", subjectRole: "instance", targetId: "", priority, ancestorId: todoId },
    { eventType: "onMove", subjectType: "module", subjectRole: "instance", targetId: "", priority, ancestorId: todoId },
    { eventType: "onMove", subjectType: "module", subjectRole: "container", targetId: todoId, priority },
  ];
  const same = (a, b) => a.eventType === b.eventType && (a.subjectRole || "") === (b.subjectRole || "")
    && (a.targetId || "") === (b.targetId || "") && (a.ancestorId || "") === (b.ancestorId || "");
  for (const w of wanted) if (!list.some((t) => same(t, w))) list.push(w);
  return list;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation, Occurrence } = models;
  const op = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  if (!op) { log(`  no "${OP_NAME}" — nothing to do`); return; }
  const todoId = todoContainerIdOf(op.pipeline);
  if (!todoId) throw new Error("could not find the Tasks › Todo container in the pipeline");
  if (!(await Occurrence.exists({ gridId, id: todoId }))) throw new Error(`Todo container ${todoId} does not exist`);
  const next = withTodoTriggers(op.triggerObjects, todoId);
  const types = [...new Set(next.map((t) => t.eventType))];
  log(`  ${OP_NAME}: triggers ${op.triggerObjects?.length || 0} -> ${next.length} (Todo ${todoId})`);
  if (!dryRun && next.length !== (op.triggerObjects?.length || 0)) {
    await Operation.updateOne({ gridId, id: op.id }, { $set: { triggerObjects: next, triggerTypes: types, updatedAt: new Date() } });
    log("  applied. RESTART pm2.");
  }
}
