/**
 * 0173 — a `Weekday` on a task places it on that weekday, every week, as a fresh copy.
 *
 * USER: *"i also want a weekday dropdown field for tasks so when i have that set and date empty, we
 * add them to the schedule for that day"*, and, settled in the same session: **a FRESH COPY each
 * week**, landing in the day's **Todo** area unless the task carries a `Time Slot`.
 *
 * THE PRIMITIVE ALREADY EXISTS AND IS REUSED RATHER THAN RESTATED. `Weekday` (`hzkcwybebz`) is the
 * field the seven weekday TEMPLATES are matched by (`0161`/`0162`), `${weekday:$day}` is already a
 * token, and `APPLY_TEMPLATE mode:"merge"` is already how a template row becomes a day's row. So
 * this is the same field and the same placement one surface over — a task is simply a one-node
 * template that happens to live on the Tasks page.
 *
 * ── WHY A COPY, AND WHY IT NEEDS NO SIGNATURE SCHEME ──────────────────────────────────────────
 *
 * The due-work path MULTI-PARENTS one row into each day, which is what makes "tick it once, it is
 * done everywhere" true — correct for a deadline, wrong for a weekly recurrence, where last week's
 * tick must not mark this week done. So the task is CLONED.
 *
 * Idempotence is `mergeSubtreeInto`'s `auto:<sourceId>` fallback: an unsigned node is matched as
 * `auto:<its own source id>` among the TARGET's children, and the clone is stamped with it. Each
 * week's column is a different target, so **the same task clones once per week and never twice
 * within a week** — the per-day-freshness property `0162` already leans on, arrived at from the
 * other side. No signature to remember, and no re-clone on every load (the failure that produced 23
 * duplicate wrappers in 2026-07-31 (3)).
 *
 * ── WEEKDAY WINS OVER DUE, and this is the load-bearing decision ──────────────────────────────
 *
 * `Schedule: Place Dated Work` phase 2 places every task carrying a `Due` value into the day's Todo
 * and then SWEEPS OUT anything in Todo it did not claim. A clone inherits its source's fields, so a
 * weekday task that also has a Due date produces a clone the due phase can see — and it would either
 * unlist that clone from the very container this op put it in (Due not today) or add a second copy
 * into Todo beside the one this op put in a SLOT (Due today). Two ops fighting over one row.
 *
 * So phase 2 gains one rule on each of its two loops: **`Weekday IS_EMPTY`**. A task with a weekday
 * is scheduled BY its weekday and is invisible to due placement, source and clone alike. One rule,
 * stated once, in place of clearing `Due` on the clone — which would have meant an UPDATE racing the
 * clone's own CREATE, the exact ordering hazard `defaultFields` exists to avoid.
 *
 * **It is additive by measurement, not by argument: 0 instances on this grid carry a Weekday today**
 * (only the 7 weekday TEMPLATES do, and they are containers, so `$allInstances` never sees them).
 * Due placement therefore behaves identically until the user sets their first weekday.
 *
 * Consequence, stated rather than hidden: a task ALREADY sitting in today's Todo that gains a
 * Weekday stays there until the column rolls over, because the sweep can no longer see it. The Todo
 * container is minted per day, so nothing carries over.
 *
 * ── NO SWEEP OF ITS OWN, deliberately ─────────────────────────────────────────────────────────
 *
 * Clearing a task's Weekday does not retract a copy already placed for today. The copy is a real
 * placed row — possibly ticked, possibly edited — and deleting it would be this op undoing a record
 * rather than tidying a link (the difference `REMOVE_CHILD` vs `DELETE` exists for, and here there
 * is no link to remove: the clone's only parent is the day column). Tomorrow's column is fresh.
 *
 * ── THE MATCH IS `CONTAINS`, so a task can recur on several days ──────────────────────────────
 *
 * `CONTAINS` is array-aware — exact member equality for a multi-select, substring for a scalar — so
 * one rule covers both without the field having to commit to one shape now. No weekday name is a
 * substring of another, which is what makes the scalar arm safe here.
 *
 * ── THE SLOT FALLS BACK TO TODO ───────────────────────────────────────────────────────────────
 *
 * A task carrying a `Time Slot` is placed in that slot; if the day has no such slot the task lands
 * in Todo rather than nowhere. A placement that silently does not happen is indistinguishable from a
 * broken op — which is precisely the defect `0172` had just repaired one container over.
 *
 * `Weekday` is bound on the task modules that exist TODAY. A task minted later inherits it from its
 * siblings once the destination-prefill work ships; until then, re-run this migration — it is
 * idempotent and gap-filling.
 */
const uid = () => Math.random().toString(36).slice(2, 14);
const OP_NAME = "Schedule: Place Weekday Tasks";
const DATED_OP = "Schedule: Place Dated Work";
const EXEMPLAR = "Schedule: Place Weekday";

export const id = "0173-weekday-tasks";
export const describe =
  "Weekday on a task places a fresh copy on that weekday every week; due placement yields to it.";

/**
 * The pipeline, exported so the behavioural test drives the SAME steps the
 * migration writes. A test over a hand-copied pipeline tests the copy.
 */
export function buildWeekdayTaskPipeline({ DATE, TS, FMT, WD, schedPageId }) {
  const act = (config) => ({ id: uid(), type: "action", config });
  const r = (left, comparator, right = "") => ({ id: uid(), left, comparator, right });

  const perTask = [
    // Reset both every iteration — a var set in a previous pass must not leak
    // into a task that has no slot of its own.
    act({ type: "SET_VAR", name: "$slotTime", value: `$task.fields.${TS}.value` }),
    act({ type: "SET_VAR", name: "$targetId", value: "$todoId" }),
    { id: uid(), type: "if",
      condition: { operator: "AND", rules: [r("$slotTime", "IS_NOT_EMPTY")] },
      then: [
        act({ type: "FIND", over: "$allContainers", itemIdVar: "$wdSlotId",
          predicate: { operator: "AND", rules: [
            r("parentId", "IS", "$dayColId"),
            r(`fields.${TS}.value`, "IS", "$slotTime"),
          ] } }),
        { id: uid(), type: "if",
          condition: { operator: "AND", rules: [r("$wdSlotId", "IS_NOT_EMPTY")] },
          then: [act({ type: "SET_VAR", name: "$targetId", value: "$wdSlotId" })],
          else: [] },
      ],
      else: [] },
    { id: uid(), type: "if",
      condition: { operator: "AND", rules: [r("$targetId", "IS_NOT_EMPTY")] },
      then: [act({
        type: "APPLY_TEMPLATE", templateRef: "$task.id", rootParent: "$targetId",
        mode: "merge", defaultFields: { [DATE]: "$day" },
      })],
      else: [] },
  ];

  return [
    act({ type: "INIT_VAR", name: "$schedPage", expr: `$allItemsById.${schedPageId}` }),
    act({ type: "INIT_VAR", name: "$schedPageId", expr: "$schedPage.id" }),
    { id: uid(), type: "if",
      condition: { operator: "AND", rules: [
        r("$schedPageId", "IS_NOT_EMPTY"),
        { id: uid(), operator: "OR", rules: [
          r("$trigger.sourceOccurrenceId", "IS_EMPTY"),
          r("$trigger.sourceOccurrenceId", "IS", "$schedPage.id"),
        ] },
      ] },
      then: [{
        id: uid(), type: "loop", overExpr: "$activePeriodDates", as: "$day",
        body: [
          act({ type: "FIND", over: "$allContainers", itemIdVar: "$dayColId",
            predicate: { operator: "AND", rules: [
              r("_ancestors", "HAS_ANCESTOR", "$schedPageId"),
              r(`fields.${FMT}.value`, "IS", "day-col"),
              r(`fields.${DATE}.value`, "SAME_DAY", "$day"),
            ] } }),
          { id: uid(), type: "if",
            condition: { operator: "AND", rules: [r("$dayColId", "IS_NOT_EMPTY")] },
            then: [
              act({ type: "SET_VAR", name: "$wd", value: "${weekday:$day}" }),
              // `parentId IS`, NOT `_ancestors HAS_ANCESTOR` — and that is the
              // whole reason this op never placed anything.
              //
              // The day column's Todo is the Schedule's OWN container
              // multi-parented into the column (2026-07-30 (7)); on poms grid
              // it is listed by the Schedule day column AND the Day Page
              // column. `_ancestors` is derived from `buildParentMap`, which
              // keys child -> ONE parent, LAST WRITER WINS — so the chain
              // resolved through the Day Page and `HAS_ANCESTOR $dayColId`
              // was false. `$todoId` came back null, `$targetId` fell back to
              // nothing, and the APPLY_TEMPLATE was gated out. Silently: no
              // error, no effects, a clean run every time.
              //
              // 2026-08-11 (4) records this exact failure for two OTHER
              // ancestor-scoped FINDs and fixed both the same way — "the
              // precise test for a direct child". The slot FIND in `perTask`
              // above already uses `parentId IS $dayColId`; this one did not,
              // in the same file, for the same container.
              act({ type: "FIND", over: "$allContainers", itemIdVar: "$todoId",
                predicate: { operator: "AND", rules: [
                  r("parentId", "IS", "$dayColId"),
                  r(`fields.${TS}.value`, "IS", "Todo"),
                ] } }),
              { id: uid(), type: "if",
                condition: { operator: "AND", rules: [r("$wd", "IS_NOT_EMPTY")] },
                then: [{
                  id: uid(), type: "loop", overExpr: "$allInstances", as: "$task",
                  body: [{
                    id: uid(), type: "if",
                    condition: { operator: "AND", rules: [
                      r(`$task.fields.${WD}.value`, "CONTAINS", "$wd"),
                      r(`$task.fields.${DATE}.value`, "IS_EMPTY"),
                      r("$task.meta.feedSourceId", "IS_EMPTY"),
                    ] },
                    then: perTask, else: [],
                  }],
                }],
                else: [] },
            ],
            else: [] },
        ],
      }],
      else: [] },
  ];
}

/**
 * Add `Weekday IS_EMPTY` to every `$allInstances` loop whose predicate already
 * tests the Due field. Exported so the test can assert the yield the same way
 * the migration performs it. Mutates `pipeline` in place; returns the counts.
 */
export function yieldDuePlacementToWeekday(pipeline, { DUE, WD }) {
  let patched = 0, alreadyPatched = 0;
  const visit = (steps) => {
    for (const s of steps || []) {
      if (s.type === "loop" && s.overExpr === "$allInstances") {
        for (const b of s.body || []) {
          const rules = b?.condition?.rules;
          if (!Array.isArray(rules)) continue;
          if (!rules.some((x) => x.left === `${s.as}.fields.${DUE}.value`)) continue;
          if (rules.some((x) => x.left === `${s.as}.fields.${WD}.value`)) { alreadyPatched++; continue; }
          rules.push({ id: uid(), left: `${s.as}.fields.${WD}.value`, comparator: "IS_EMPTY", right: "" });
          patched++;
        }
      }
      visit(s.body); visit(s.then); visit(s.else);
    }
  };
  visit(pipeline?.steps);
  return { patched, alreadyPatched };
}

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields, ops] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(), Operation.find({ gridId }).lean(),
  ]);
  const mById = new Map(mods.map((m) => [m.id, m]));
  const oById = new Map(occs.map((o) => [o.id, o]));
  const lbl = (o) => o?.label || mById.get(o?.moduleId)?.label || o?.id;

  const SF = grid?.meta?.scheduleFieldIds || {};
  const DATE = SF.dateFieldId, TS = SF.timeslotFieldId, FMT = SF.scheduleFormatFieldId;
  const SCHED_PAGE = SF.pageOccurrenceId;
  const WD = fields.find((f) => f.name === "Weekday" && !f.displayEnabled)?.id;
  if (!DATE || !TS || !FMT || !SCHED_PAGE) { log("  REFUSING: incomplete scheduleFieldIds"); return; }
  if (!WD) { log('  REFUSING: no "Weekday" field — run 0161 first'); return; }

  const exemplar = ops.find((o) => o.name === EXEMPLAR);
  const dated = ops.find((o) => o.name === DATED_OP);
  if (!exemplar) { log(`  REFUSING: no "${EXEMPLAR}" to copy the trigger surface from`); return; }
  if (!dated) { log(`  REFUSING: no "${DATED_OP}" to yield to this op`); return; }

  // ── 1. bind Weekday on the task modules ────────────────────────────────────
  // Structural: the instance modules placed under the Tasks page. Never a name
  // list — a task the user renames must keep the field.
  const tasksPage = occs.filter((o) =>
    mById.get(o.moduleId)?.role === "page" && String(lbl(o)) === "Tasks");
  if (tasksPage.length !== 1) { log(`  REFUSING: expected exactly one Tasks page, found ${tasksPage.length}`); return; }
  const taskModIds = new Set();
  for (const cid of tasksPage[0].occurrences || []) {
    for (const gid of oById.get(cid)?.occurrences || []) {
      const g = oById.get(gid);
      if (g && mById.get(g.moduleId)?.role === "instance") taskModIds.add(g.moduleId);
    }
  }
  const toBind = [...taskModIds]
    .map((id) => mById.get(id))
    .filter((m) => m && !(m.fieldBindings || []).some((b) => b.fieldId === WD));
  log(`  task modules: ${taskModIds.size} · already bound: ${taskModIds.size - toBind.length} · to bind: ${toBind.length}`);

  // ── 2. the op ──────────────────────────────────────────────────────────────
  const steps = buildWeekdayTaskPipeline({ DATE, TS, FMT, WD, schedPageId: SCHED_PAGE });

  // ── 3. due placement yields to a weekday ───────────────────────────────────
  // Both phase-2 loops — the CLAIM and the SWEEP — gain `Weekday IS_EMPTY`.
  // Found structurally: a loop over `$allInstances` whose predicate already
  // tests the Due field. Never by step index, which a later edit would shift.
  const DUE = fields.find((f) => f.name === "Due" && f.type === "date" && !f.displayEnabled)?.id;
  if (!DUE) { log('  REFUSING: no date-typed "Due" field to scope the yield rule to'); return; }
  const datedPipe = JSON.parse(JSON.stringify(dated.pipeline));
  const { patched, alreadyPatched } = yieldDuePlacementToWeekday(datedPipe, { DUE, WD });
  log(`  "${DATED_OP}": ${patched} loop(s) gained "Weekday IS_EMPTY"${alreadyPatched ? ` · ${alreadyPatched} already had it` : ""}`);
  if (!patched && !alreadyPatched) { log("  REFUSING: found no Due-scoped loop to yield — the op's shape changed"); return; }

  const carriers = occs.filter((o) =>
    mById.get(o.moduleId)?.role === "instance" && o.fields?.[WD]?.value);
  log(`  instances already carrying a Weekday: ${carriers.length}${carriers.length ? " — " + carriers.map(lbl).join(", ") : " (so the yield rule is inert today)"}`);

  const existing = ops.find((o) => o.name === OP_NAME);
  log(`  op "${OP_NAME}": ${existing ? "exists — replacing its pipeline" : "to create"} · ${steps.length} top-level step(s)`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  for (const m of toBind) {
    const bindings = [...(m.fieldBindings || [])];
    const at = bindings.findIndex((b) => b.fieldId === DATE);
    const entry = { fieldId: WD, role: "input" };
    if (at >= 0) bindings.splice(at + 1, 0, entry); else bindings.push(entry);
    await Module.updateOne({ id: m.id, gridId }, { $set: { fieldBindings: bindings } });
  }
  if (patched) await Operation.updateOne({ _id: dated._id }, { $set: { pipeline: datedPipe } });

  const doc = {
    name: OP_NAME, enabled: true, gridId, userId: exemplar.userId,
    pipeline: { sources: [], steps },
    triggerTypes: exemplar.triggerTypes,
    // Same events as the weekday TEMPLATE placement, one priority later so the
    // column and its slots exist before anything is placed into them.
    triggerObjects: (exemplar.triggerObjects || []).map((t) => ({ ...t, priority: 3 })),
    targetOccurrenceId: exemplar.targetOccurrenceId ?? null,
    folderId: exemplar.folderId ?? null,
  };
  if (existing) await Operation.updateOne({ _id: existing._id }, { $set: doc });
  else await Operation.create({ id: uid(), ...doc });
  log(`  bound Weekday on ${toBind.length} task module(s) · ${existing ? "replaced" : "created"} "${OP_NAME}" — RESTART pm2 and reload.`);
}
