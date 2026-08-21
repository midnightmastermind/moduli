/**
 * 0179 — a ticked task files itself into `Tasks › Completed` once the day rolls over.
 *
 * USER: *"make sure appointments or tasks set to complete in the tasks, get properly sent to
 * completed at the end of the day even if they arent on the schedule"*.
 *
 * ── "AT THE END OF THE DAY" IS THE WHOLE SPECIFICATION ────────────────────────────────────────
 *
 * A task ticked at 9am must stay where it is for the rest of the day — you want to SEE what you got
 * done today, in the container you did it in. It files itself tomorrow. So the gate is not "is it
 * ticked", it is **"is it ticked and was it ticked on a PREVIOUS day"**:
 *
 *     Completed IS true   AND   Completed On DATE_BEFORE_TODAY
 *
 * `Completed On` is written by `Schedule: Stamp Completed On` (onChange, priority 0) and cleared on
 * un-tick, so it is already the grid's record of WHEN. Nothing new records anything.
 *
 * ── THE GATE WAS BROKEN BEFORE THIS OP COULD USE IT, AND ONLY MEASURING FOUND IT ─────────────
 *
 * `DATE_BEFORE_TODAY` parsed with `new Date(value)`, which reads a bare `YYYY-MM-DD` as **UTC
 * midnight** — the previous local evening anywhere west of UTC. Measured in CDT (UTC-5):
 *
 *     $today = "2026-08-21"   DATE_BEFORE_TODAY -> TRUE     <- today's own stamp reads as PAST
 *
 * So this op would have filed every task **the instant it was ticked**, which is precisely the
 * opposite of what was asked for — and it would have looked correct in UTC. `DATE_IS_TODAY` and
 * `DATE_AFTER_TODAY` were wrong the same way; `DATE_BEFORE`, one `case` above them, had been
 * written against this exact trap and carries a comment saying so. **Three neighbours of an
 * already-fixed case** — the `SET_VAR`/`MULTIPLY_VAR` class this repo has paid for before. All
 * three now read one shared `dayKeyOf`, pinned by `dateTodayComparators.test.js`, which fails 3
 * cases against the old parse.
 *
 * That fix is also a small live repair in its own right: the grid's ONE stored use of the
 * comparator is `Compute Next Due`, which had been treating a bill due TODAY as already overdue.
 *
 * ── IT NEVER USES `HAS_ANCESTOR`, AND THAT IS DELIBERATE ─────────────────────────────────────
 *
 * The obvious scope is `HAS_ANCESTOR <Tasks page>`. It is not reliable for exactly these rows:
 * `_ancestors` comes from `buildParentMap`, which keys child → ONE parent, **last writer wins** —
 * and a task on the Tasks page is routinely ALSO listed by a day column's `Todo` (measured: `Talk
 * to Angela about Vivance` has three listers). So its ancestor chain resolves arbitrarily to the
 * Schedule on some loads and to Tasks on others.
 *
 * Instead it walks the Tasks page's OWN `occurrences[]` two levels down — page → dimension
 * container → task — the idiom `0177` uses for the weekday templates. Exact, order-stable, and
 * immune to multi-parenting.
 *
 * ── THE DESTINATION IS SKIPPED BY ID, NOT BY NAME ────────────────────────────────────────────
 *
 * The `Completed` container is one of the page's own children, so the outer loop would walk into it
 * and re-file what is already filed. It is skipped by its occurrence id; matching the label
 * "Completed" would break the day somebody renames it.
 *
 * ── WHY THE MOVE, AND WHY IT NEEDED `0178` FIRST ────────────────────────────────────────────
 *
 * `LINK_OCCURRENCE_TO_PARENT` emits ONE `UPDATE_ITEM_PARENT`, which unlists from `occ.parentId`,
 * re-parents, and lists under the destination. Four rows on this grid had a `parentId` naming a
 * container that did not list them, so the unlist would have missed and the row would have shown up
 * in BOTH places. `0178` repaired those; this op is unsafe without it.
 *
 * `ADD_CHILD` was the alternative and is wrong here: it only LISTS, so the task would appear in
 * Completed *and* stay in its dimension container forever. Filing is a MOVE.
 *
 * ── THE ORIGIN IS RECORDED, BECAUSE UN-FILING IS NOT ANSWERABLE WITHOUT IT ───────────────────
 *
 * `meta.filedFrom` keeps the container the task came from. Nothing reads it yet and this op does not
 * un-file — un-ticking a task in Completed is a real case with no obvious answer, and inventing one
 * is the `0052` rule. But the fact is free to record NOW and impossible to recover later, so the
 * reverse stays buildable without a second data migration.
 *
 * ── THE ONE-OFF SWEEP, WHICH IS THE USER'S OWN CALL ─────────────────────────────────────────
 *
 * `DATE_BEFORE_TODAY` fails CLOSED on an empty value, so a ticked row with no stamp is never filed
 * by the op — correct, because a row ticked seconds ago (before the stamp op ran) must not vanish.
 * That leaves the rows ticked BEFORE the stamp op existed. Measured: **3** — `Talk to Angela about
 * Vivance`, `Psych appointment with Angela`, `Sign up for foodstamps` — which is exactly the number
 * the user was asked about, and their answer was *"MOVE THEM NOW"*, over inventing a completion
 * date for them. So the migration files those three itself and writes NO `Completed On`: a
 * plausible date is indistinguishable from a real one.
 *
 * Idempotent: the sweep only matches ticked rows sitting outside Completed, so a second run moves
 * nothing.
 */
const uid = () => Math.random().toString(36).slice(2, 14);
const OP_NAME = "Tasks: File Completed";

export const id = "0179-file-completed-tasks";
export const describe =
  "Move tasks ticked on a PREVIOUS day into `Tasks › Completed`, via a new onLoad operation. " +
  "Also files the 3 rows ticked before `Completed On` existed. Deletes nothing.";

/**
 * The pipeline, exported so a test drives the SAME steps the migration writes.
 * A test over a hand-copied pipeline tests the copy.
 */
export function buildFileCompletedPipeline({ tasksPageId, doneContainerId, COMPLETED, COMPLETED_ON }) {
  const act = (config) => ({ id: uid(), type: "action", config });
  const r = (left, comparator, right = "") => ({ id: uid(), left, comparator, right });

  return [
    act({ type: "INIT_VAR", name: "$tasksPage", expr: `$allItemsById.${tasksPageId}` }),
    {
      id: uid(), type: "loop", overExpr: "$tasksPage.occurrences", as: "$binId",
      body: [
        {
          id: uid(), type: "if",
          // Skip the destination itself, by id. A label match would break on rename.
          condition: { operator: "AND", rules: [r("$binId", "IS_NOT", doneContainerId)] },
          then: [
            act({ type: "SET_VAR", name: "$bin", value: "$allItemsById.${$binId}" }),
            {
              id: uid(), type: "loop", overExpr: "$bin.occurrences", as: "$taskId",
              body: [
                act({ type: "SET_VAR", name: "$task", value: "$allItemsById.${$taskId}" }),
                {
                  id: uid(), type: "if",
                  condition: { operator: "AND", rules: [
                    r(`$task.fields.${COMPLETED}.value`, "IS", true),
                    // Empty stamp -> false. A row ticked moments ago stays put.
                    r(`$task.fields.${COMPLETED_ON}.value`, "DATE_BEFORE_TODAY"),
                  ] },
                  then: [
                    // Record the origin BEFORE the move — afterwards $binId is
                    // no longer the row's parent and the fact is unrecoverable.
                    act({ type: "UPDATE", path: "$task.meta.filedFrom", value: "$binId" }),
                    act({ type: "LINK_OCCURRENCE_TO_PARENT", parentId: doneContainerId, childId: "$taskId" }),
                  ],
                  else: [],
                },
              ],
            },
          ],
          else: [],
        },
      ],
    },
  ];
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields, ops] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(), Operation.find({ gridId }).lean(),
  ]);
  const mById = new Map(mods.map((m) => [m.id, m]));
  const oById = new Map(occs.map((o) => [o.id, o]));
  const lbl = (o) => o?.label || mById.get(o?.moduleId)?.label || o?.id;

  const COMPLETED = fields.find((f) => f.name === "Completed" && f.type === "boolean")?.id;
  const COMPLETED_ON = fields.find((f) => f.name === "Completed On" && f.type === "date")?.id;
  if (!COMPLETED)    { log('  REFUSING: no boolean "Completed" field'); return; }
  if (!COMPLETED_ON) { log('  REFUSING: no date "Completed On" field — run 0053 first'); return; }

  const tasksPages = occs.filter((o) => mById.get(o.moduleId)?.role === "page" && String(lbl(o)) === "Tasks");
  if (tasksPages.length !== 1) { log(`  REFUSING: expected exactly one Tasks page, found ${tasksPages.length}`); return; }
  const tasksPage = tasksPages[0];

  // The destination is resolved by LABEL exactly once, here, and its ID is what
  // gets baked into the pipeline — so a later rename cannot break the op.
  const bins = (tasksPage.occurrences || []).map((id) => oById.get(id)).filter(Boolean);
  const done = bins.filter((c) => String(lbl(c)) === "Completed");
  if (done.length !== 1) { log(`  REFUSING: expected exactly one "Completed" container on Tasks, found ${done.length}`); return; }
  const doneId = done[0].id;

  // The trigger surface is copied from a load-fired op rather than restated.
  const exemplar = ops.find((o) => o.name === "Grid: Snap Filter To Today");
  if (!exemplar) { log('  REFUSING: no "Grid: Snap Filter To Today" to copy the onLoad trigger surface from'); return; }

  // ── the one-off sweep ──────────────────────────────────────────────────────
  // Ticked, sitting in a dimension container rather than Completed, and carrying
  // no stamp for the op to read. Anything WITH a stamp is left to the op, so the
  // two halves cannot both act on one row.
  const legacy = [];
  for (const bin of bins) {
    if (bin.id === doneId) continue;
    for (const tid of bin.occurrences || []) {
      const t = oById.get(tid);
      if (!t) continue;
      if (t.fields?.[COMPLETED]?.value !== true) continue;
      const stamp = t.fields?.[COMPLETED_ON]?.value;
      if (stamp) continue;                       // the op's job, not the sweep's
      legacy.push({ occ: t, from: bin });
    }
  }

  const existing = ops.find((o) => o.name === OP_NAME);
  const steps = buildFileCompletedPipeline({
    tasksPageId: tasksPage.id, doneContainerId: doneId, COMPLETED, COMPLETED_ON,
  });

  log(`  Tasks page ${tasksPage.id} · ${bins.length} container(s) · destination "Completed" ${doneId}`);
  log(`  op "${OP_NAME}": ${existing ? "exists — replacing its pipeline" : "to create"}`);
  log(`  one-off sweep — ticked with no stamp, outside Completed: ${legacy.length}`);
  for (const l of legacy) log(`    MOVE  ${lbl(l.occ)} (${l.occ.id})  from ${lbl(l.from)}`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  for (const l of legacy) {
    // The same three writes UPDATE_ITEM_PARENT performs, in the same order:
    // unlist from the origin, re-parent, list under the destination.
    await Occurrence.updateOne({ id: l.from.id, gridId },
      { $pull: { occurrences: l.occ.id } });
    await Occurrence.updateOne({ id: l.occ.id, gridId },
      { $set: { parentId: doneId, "meta.filedFrom": l.from.id } });
    await Occurrence.updateOne({ id: doneId, gridId },
      { $addToSet: { occurrences: l.occ.id } });
  }

  const doc = {
    name: OP_NAME, enabled: true, gridId, userId: exemplar.userId,
    description:
      "On load, move any task in a Tasks dimension container that was completed on a PREVIOUS day " +
      "into Tasks › Completed. Today's completions stay where they are until the day rolls over.",
    pipeline: { sources: [], steps },
    triggerTypes: exemplar.triggerTypes,
    // Priority 9 — after everything that builds or places, so a task the
    // schedule work has just touched is filed against settled state.
    triggerObjects: (exemplar.triggerObjects || []).map((t) => ({ ...t, priority: 9 })),
    targetOccurrenceId: tasksPage.id,
    folderId: exemplar.folderId ?? null,
  };
  if (existing) await Operation.updateOne({ _id: existing._id }, { $set: doc });
  else await Operation.create({ id: uid(), ...doc });

  log(`  filed ${legacy.length} · op ${existing ? "updated" : "created"} — RESTART pm2 so the warm cache re-reads.`);
}
