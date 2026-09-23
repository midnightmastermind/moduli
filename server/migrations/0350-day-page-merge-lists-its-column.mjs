// 0350 — a day column that already EXISTS gets listed by its board too.
//
// The second shape of the unlisted-column bug. The first (2026-09-23 (2)) was
// the SCHEDULE build: it finds its column by `_ancestors HAS_ANCESTOR`, which
// is built from `occurrences[]`, so it cannot see an unlisted column at all,
// falls through to a create, and the create is refused as a duplicate —
// `adoptableHolders` now re-lists the holder there.
//
// `Day Page: Build` fails the other way round. It finds its column by
// **parentId**, so it DOES see an unlisted one — and then merges into it and
// never lists it:
//
//   if ($colId IS_EMPTY)
//     THEN  APPLY_TEMPLATE (create) -> ADD_CHILD(board, $colId)   <- lists it
//     ELSE  APPLY_TEMPLATE (merge)                                 <- never does
//
// So a column that loses its listing once is invisible for good: every later
// load finds it, tops it up, and leaves it unreachable. Measured on poms —
// `daypage:col:2026-08-26`, 5 children, unlisted since the day it was made,
// the only such row in 25,285 occurrences.
//
// THE FIX IS THE ONE THE USER PICKED: move the listing BELOW the branch so both
// paths run it. `ADD_CHILD` is idempotent (its own handler no-ops when the child
// is already in `parent.occurrences[]`), so the create path is unchanged — it
// simply runs the same step one level out. That is also why this is safe to
// apply to a grid whose columns are all healthy: on every one of them it is a
// no-op.
//
// Scoped to the ADD_CHILD whose parent is the op's own board and whose child is
// the column var it just bound. A blanket "move every ADD_CHILD" would also
// move the one that multi-parents the shared Emotions Wheel into the column,
// which belongs exactly where it is.

export const id = "0350-day-page-merge-lists-its-column";
export const describe = "Day Page: Build lists its day column from BOTH branches, so an existing-but-unlisted column is re-listed instead of staying invisible.";
export const touches = ["operations"];

const OP_NAME = "Day Page: Build";

const isColumnAddChild = (s, colVar) =>
  s?.type === "action" &&
  s.config?.type === "ADD_CHILD" &&
  typeof s.config.childId === "string" &&
  s.config.childId === colVar;

/**
 * Pure: returns { pipeline, changed, reason }.
 *
 * Finds the loop body that carries the create/merge `if`, takes the ADD_CHILD
 * that lists the column out of the THEN branch, and puts it immediately after
 * the branch. Idempotent — running it twice reports "already lists from both
 * branches".
 */
export function listColumnFromBothBranches(pipeline) {
  const clone = JSON.parse(JSON.stringify(pipeline || {}));
  let changed = false;
  let reason = "no create/merge branch found";

  const walk = (steps) => {
    if (!Array.isArray(steps)) return;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s?.type === "if" && Array.isArray(s.then) && Array.isArray(s.else)) {
        // The branch we want binds the column: its THEN applies a template with
        // a rootIdVar, and that same var is what the ADD_CHILD lists.
        const apply = s.then.find((t) => t?.config?.type === "APPLY_TEMPLATE" && t.config.rootIdVar);
        const colVar = apply?.config?.rootIdVar;
        if (colVar) {
          const already = steps.slice(i + 1).some((t) => isColumnAddChild(t, colVar));
          if (already) { reason = "already lists from both branches"; }
          else {
            const at = s.then.findIndex((t) => isColumnAddChild(t, colVar));
            if (at >= 0) {
              const [moved] = s.then.splice(at, 1);
              steps.splice(i + 1, 0, moved);        // after the whole if/else
              changed = true;
              reason = `moved ADD_CHILD(${moved.config.parentId} <- ${colVar}) below the branch`;
            } else {
              reason = "the THEN branch does not list the column";
            }
          }
          return;   // one such branch per pipeline
        }
      }
      for (const k of ["body", "then", "else"]) if (Array.isArray(s?.[k])) walk(s[k]);
    }
  };

  walk(clone.steps);
  return { pipeline: clone, changed, reason };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const op = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  if (!op) { log(`no "${OP_NAME}" op on this grid — nothing to do.`); return; }

  const { pipeline, changed, reason } = listColumnFromBothBranches(op.pipeline);
  if (!changed) { log(`unchanged: ${reason}.`); return; }
  log(`${OP_NAME} (${op.id}): ${reason}.`);
  if (dryRun) return;

  await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
  const after = await Operation.findOne({ gridId, id: op.id }).lean();
  if (listColumnFromBothBranches(after.pipeline).reason !== "already lists from both branches") {
    throw new Error("readback: the listing did not move below the branch");
  }
  log("applied and read back.");
}
