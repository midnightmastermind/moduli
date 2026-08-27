/**
 * 0267 — the weekday-task op could never find the Todo it places into.
 *
 * `Schedule: Place Weekday Tasks` (`0173`) silently places NOTHING on any day
 * whose Todo has picked up a second parent. It runs clean — no error, no
 * effects — because the FIND that resolves its destination cannot match.
 *
 * ── THE PREDICATE ────────────────────────────────────────────────────────
 * ```
 * FIND $allContainers -> $todoId
 *    _ancestors HAS_ANCESTOR $dayColId        <- could not match
 *    fields.<Time Slot>.value IS "Todo"
 * ```
 * The day column's Todo is the Schedule's OWN container multi-parented into
 * the column (2026-07-30 (7)). On poms grid it is listed by the Schedule day
 * column AND the Day Page column. `_ancestors` is derived from
 * `buildParentMap`, which keys child -> ONE parent, **last writer wins** — so
 * the chain resolved through the Day Page and `HAS_ANCESTOR $dayColId` was
 * false.
 *
 * `$todoId` came back null, `$targetId` fell back to nothing, and the
 * APPLY_TEMPLATE was gated out. Silently.
 *
 * ── IT IS DATA-DEPENDENT, AND I OVERSTATED IT FIRST ──────────────────────
 * Measured on live data rather than asserted. Driving the STORED op over the
 * live grid with one synthetic weekday task, and A/B-ing the predicate in
 * memory on the SAME data:
 * ```
 *   2026-08-27 column   Todo listed by 1 parent    parentId 1 fx · ancestors 1 fx
 *   2026-08-24 fixture  Todo listed by 2 parents   parentId 1 fx · ancestors 0 fx
 * ```
 * So it is not "never" — it is "whenever a Day Page column also lists that
 * day's Todo", which is what the 08-24 snapshot caught and what will happen
 * again. A bug that works on the day you test it is worse than one that never
 * does, and the first version of this header claimed the stronger, wrong
 * thing.
 *
 * ── IT IS THE THIRD TIME, AND THE FIX IS THE ONE ALREADY WRITTEN DOWN ────
 * 2026-08-11 (4) records this exact failure for TWO other ancestor-scoped
 * FINDs the moment Todo gained a second parent, and fixed both by keying on
 * `parentId` — "the precise test for a direct child". `0173` was written
 * afterwards and used the ancestor form anyway. Its OWN sibling FIND, the one
 * that resolves a task's time slot four lines up, already reads
 * `parentId IS $dayColId`. Two FINDs, one file, one container, two predicates
 * — and the inconsistent one was the dead one.
 *
 * ── WHY NOBODY NOTICED ───────────────────────────────────────────────────
 * poms grid carries **0 instances with a Weekday** — all 8 carriers are the
 * workout/meal/routine CONTAINERS, which a DIFFERENT op merges. So the feature
 * has no live data and its failure is invisible: the user sets a Weekday on a
 * task and nothing happens.
 *
 * ── SURGICAL ─────────────────────────────────────────────────────────────
 * It rewrites ONE rule inside the ONE FIND whose `itemIdVar` is `$todoId`, and
 * only when that rule is exactly the ancestor form. Anything else is reported
 * and left. Re-running is a no-op.
 */

export const id = "0267-weekday-todo-find-by-parent";
export const describe =
  "Points the weekday-task op's Todo FIND at `parentId IS $dayColId` instead of `_ancestors HAS_ANCESTOR $dayColId`. The Todo is multi-parented, so the ancestor chain resolved through the Day Page and the FIND never matched — the op has never placed a task.";
export const touches = ["operations"];

export const OP_NAME = "Schedule: Place Weekday Tasks";

/** Walk every nested step list. */
function visit(steps, fn) {
  for (const s of steps || []) {
    fn(s);
    visit(s.body, fn); visit(s.then, fn); visit(s.else, fn); visit(s.thenSteps, fn);
  }
}

/**
 * Pure. Returns { patched, reason } — `patched` is a deep-cloned step list, or
 * null when there is nothing to do.
 */
export function planTodoFindFix(steps) {
  const next = structuredClone(steps || []);
  let found = 0, already = 0, changed = 0;
  visit(next, (s) => {
    const cfg = s.config || s;
    if (cfg?.type !== "FIND" || cfg.itemIdVar !== "$todoId") return;
    found++;
    const rules = cfg.predicate?.rules || [];
    const i = rules.findIndex((r) => r.left === "_ancestors" && r.comparator === "HAS_ANCESTOR" && r.right === "$dayColId");
    if (i === -1) {
      if (rules.some((r) => r.left === "parentId" && r.comparator === "IS" && r.right === "$dayColId")) already++;
      return;
    }
    rules[i] = { ...rules[i], left: "parentId", comparator: "IS", right: "$dayColId" };
    changed++;
  });
  if (!found) return { patched: null, reason: "no FIND binding $todoId — refusing rather than guessing" };
  if (!changed) return { patched: null, reason: already ? "already keyed on parentId" : "the ancestor rule is not in the shape this migration knows" };
  return { patched: next, reason: `rewrote ${changed} rule(s) across ${found} FIND(s)` };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const op = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  if (!op) { log(`no operation named "${OP_NAME}" — nothing to do.`); return; }
  const { patched, reason } = planTodoFindFix(op.pipeline?.steps);
  log(`"${OP_NAME}" — ${reason}`);
  if (!patched) return;
  if (dryRun) { log("DRY RUN — nothing written."); return; }
  await Operation.updateOne({ gridId, id: op.id }, { $set: { "pipeline.steps": patched } });
  log("stored pipeline updated.");
}
