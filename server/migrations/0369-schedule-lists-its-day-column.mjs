// server/migrations/0369-schedule-lists-its-day-column.mjs
//
// "Schedule: Build Schedule" re-lists its day column on EVERY run, as
// "Day Page: Build" has since 0350.
//
// THE TRAP (user, 2026-09-26: "schedule didnt get created again … audit why
// this keeps happening with Schedule and Daypage, they get unlinked often").
// Today's column existed — signed, 49 slots, parentId = the Schedule page — and
// the page's occurrences[] did not list it, so nothing drew it. The build then
// never repaired it: it finds a day's column by `_ancestors HAS_ANCESTOR` the
// page, ancestry falls back to the column's own parentId, so the column was
// FOUND, no create was attempted, and the server's adopt-an-unlisted-holder
// repair (which only runs on a refused create) never fired. Found and never
// listed is a permanent state.
//
// An ADD_CHILD after the find-or-create branch lists the column whether it was
// just made or found; ADD_CHILD is idempotent, so a listed column is untouched.
// (What unlisted it — a whole-array write from a stale copy of the page — is
// fixed separately: child-list writes now carry their base, see
// socketHandlers/occurrences.js mergeChildListWithBase.)

export const id = "0369-schedule-lists-its-day-column";
export const describe = "Schedule: Build Schedule re-lists each day column on the Schedule page every run (self-heals an unlisted column).";
export const touches = ["operations"];

const OP_NAME = "Schedule: Build Schedule";
export const LIST_STEP_ID = "list-day-col";

const isColumnCreateIf = (s) => s?.type === "if" && (s.then || []).some((t) =>
  t?.config?.type === "CREATE" && t.config.itemIdVar === "$dayColId" && String(t.config.identitySignature || "").startsWith("schedule:col:"));

/** PURE. { pipeline, changed, reason }. */
export function listDayColumnEveryRun(pipeline) {
  const clone = JSON.parse(JSON.stringify(pipeline || {}));
  let found = 0, changed = false;
  const walk = (steps) => {
    if (!Array.isArray(steps)) return;
    const i = steps.findIndex(isColumnCreateIf);
    if (i !== -1) {
      found++;
      const parentId = steps[i].then.find((t) => t?.config?.type === "CREATE").config.parent;
      if (steps[i + 1]?.id !== LIST_STEP_ID) {
        steps.splice(i + 1, 0, { id: LIST_STEP_ID, type: "action", config: { type: "ADD_CHILD", parentId, childId: "$dayColId" } });
        changed = true;
      }
    }
    for (const s of steps) for (const k of ["then", "else", "body"]) walk(s?.[k]);
  };
  walk(clone.steps);
  if (found !== 1) throw new Error(`expected exactly 1 day-column create branch, found ${found} — refusing`);
  return { pipeline: clone, changed, reason: changed ? "added" : "already lists every run" };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const op = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  if (!op) { log(`no "${OP_NAME}" — nothing to do`); return; }
  const { pipeline, changed, reason } = listDayColumnEveryRun(op.pipeline);
  log(`"${OP_NAME}": ${reason}`);
  if (dryRun || !changed) return;
  await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
  log("done. Restart the server (pm2).");
}
