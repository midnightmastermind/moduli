/**
 * 0162 — `Schedule: Place Weekday` replaces `Schedule: Place Cycle Day`.
 *
 * USER, 2026-08-20: ***"i dont want a cycle, i just want 7 day templates"***.
 *
 * IT IS THE CYCLE OP'S PIPELINE WITH ONE BLOCK SWAPPED, deliberately. Everything around the
 * template lookup — the source guard, the `$activePeriodDates` loop, the day-column FIND, the slot
 * match on the `Time Slot` VALUE, the `APPLY_TEMPLATE mode:"merge"` per row — is proven on this grid
 * and is copied step for step. What changes is how the day's template is chosen:
 *
 *     was   read `Cycle Day` off the column, or advance a MARKER occurrence 1->2->3->4->5->1,
 *           then map that name to one of five ids baked into the pipeline
 *     now   `${weekday:$day}` -> FIND the template whose own `Weekday` field IS that day
 *
 * THE TEMPLATE IS FOUND BY ITS FIELD, NOT BY A BAKED ID — which is what the user's *"give the
 * templates weekday fields"* actually buys. Baking seven ids would make the field decorative: change
 * a template's Weekday and the op would ignore it. Resolving through the field means the data is the
 * source of truth, and a template can be renamed, rebuilt or replaced without touching an operation.
 *
 * AND IT PLACES EVERY ROW, where the cycle op placed only rows carrying a Meal or Movement PICK.
 * That filter is what made the cycle op safe to point at a template that also held the daily
 * routines. **It is also what would make this feature pointless**: the user's reason for wanting
 * weekdays is *"i can put specific appointments certain days that are repeatable"*, and an
 * appointment carries neither pick. `0161` strips the daily routines out of the weekday templates so
 * that placing everything is the correct behaviour rather than a duplication bug.
 *
 * IDEMPOTENCE IS `mergeSubtreeInto`'s `auto:<sourceId>` FALLBACK, and it is worth being explicit
 * about because it is the whole reason an unsigned row is safe. Merge skips a template node whose
 * signature already exists under the target; a node nobody hand-signed is matched as
 * `auto:<its own template id>`. So a row the user drags onto Tuesday's template is placed once and
 * recognised on every load after — no signature scheme to remember, and no re-clone on every sweep,
 * which is the failure mode that produced 23 duplicate wrappers in 2026-07-31 (3).
 *
 * THE CYCLE OP IS DISABLED, NOT DELETED. It is 130 steps of working pipeline and the `Cycle Day`
 * values it wrote onto past columns stay readable. Nothing resolves it any more.
 *
 * TODAY'S COLUMN IS RE-POINTED, and only because the numbers say it is safe. It holds Wednesday's
 * Pull session, placed this morning while the cycle was still running, and today is a Thursday. Each
 * of those six rows was measured against the movement catalog first:
 *
 *     Deadlifts 5/5/5/5 · Pull-Ups 6/6/6/6 · Bent-Over Rows 8/8/8/8 · DB Rows 8/8/8
 *     Bicep Curls 10/10/10 · Hammer Curls 12/12/12      <- every one EQUAL to the catalog
 *     Completed: null on all six                        <- nothing ticked
 *
 * Every set value is the PRESCRIPTION `0119` backfilled from the movement option, not a logged
 * performance, and no row is marked done. So this carries "nothing the user entered" by `0109`'s own
 * discriminator, and removing it loses no record of a workout. Rows are dumped to `backups/orphans/`
 * before they go. **If any row had differed from its catalog prescription, or been ticked, the rule
 * would keep it and say so** — a workout log is not something a migration gets to tidy.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const id = "0162-place-weekday-template";
export const describe = "Create Schedule: Place Weekday (template resolved by its Weekday field), disable the cycle op, and clear today's stale cycle placement.";

const OP_NAME = "Schedule: Place Weekday";
const CYCLE_OP = "Schedule: Place Cycle Day";
const SCHEDULE_PAGE = "llpF10Bda5nu";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields, ops] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(), Operation.find({ gridId }).lean(),
  ]);
  const mById = new Map(mods.map(m => [m.id, m]));
  const oById = new Map(occs.map(o => [o.id, o]));
  const lbl = (o) => o?.label || mById.get(o?.moduleId)?.label || "";
  const SF = grid?.meta?.scheduleFieldIds || {};
  const FMT = SF.scheduleFormatFieldId, DATE = SF.dateFieldId;
  const TS = fields.find(f => f.name === "Time Slot" && !f.displayEnabled)?.id;
  const WD = fields.find(f => f.name === "Weekday")?.id;
  const MV = fields.find(f => f.name === "Movement" && !f.displayEnabled)?.id;
  const CMP = fields.find(f => f.name === "Completed" && !f.displayEnabled)?.id;
  const SETS = [1, 2, 3, 4].map(n => fields.find(f => f.name === `Set ${n}` && !f.displayEnabled)?.id).filter(Boolean);
  if (!WD) { log("  REFUSING: no \"Weekday\" field - run 0161 first"); return; }
  if (!FMT || !DATE || !TS) { log("  REFUSING: missing schedule field ids"); return; }

  const stPage = occs.find(o => lbl(o) === "Schedule Template");
  const weekdayTemplates = (stPage?.occurrences || []).map(i => oById.get(i))
    .filter(t => t?.fields?.[WD]?.value);
  log(`  templates carrying a Weekday: ${weekdayTemplates.length} (${weekdayTemplates.map(t => t.fields[WD].value).join(", ")})`);
  if (weekdayTemplates.length !== 7) { log("  REFUSING: expected 7 weekday templates - run 0161 first"); return; }

  const existing = ops.find(o => o.name === OP_NAME);
  const cycle = ops.find(o => o.name === CYCLE_OP);

  // ---- today's stale cycle placement, measured before it is touched -------
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const TODAY = key(new Date());
  const column = occs.find(o => o.fields?.[FMT]?.value === "day-col"
    && String(o.fields?.[DATE]?.value || "").slice(0, 10) === TODAY);
  const parentOf = new Map();
  for (const o of occs) for (const c of o.occurrences || []) if (!parentOf.has(c)) parentOf.set(c, o.id);
  const underColumn = (id2) => { let cur = id2, seen = new Set();
    while (cur && !seen.has(cur)) { seen.add(cur); const p = parentOf.get(cur) ?? oById.get(cur)?.parentId;
      if (!p) break; if (p === column?.id) return true; cur = p; } return false; };

  const stale = [], kept = [];
  if (column && MV) {
    for (const r of occs.filter(o => o.fields?.[MV]?.value && !o.meta?.feedSourceId && underColumn(o.id))) {
      const optId = (Array.isArray(r.fields[MV].value) ? r.fields[MV].value : [r.fields[MV].value])[0];
      const opt = oById.get(optId);
      const ticked = r.fields?.[CMP]?.value === true;
      // Equal to the catalog on every set = the prescription `0119` backfilled,
      // not a performance. Any difference at all means the user typed something.
      const logged = SETS.some(s => (r.fields?.[s]?.value ?? null) !== (opt?.fields?.[s]?.value ?? null));
      (ticked || logged ? kept : stale).push({ row: r, name: lbl(opt), why: ticked ? "ticked" : logged ? "sets differ from the catalog" : "" });
    }
  }
  log(`  today's column: ${column ? column.id : "none for today"}`);
  log(`  stale cycle rows to clear: ${stale.length}${stale.length ? ` (${stale.map(s => s.name).join(", ")})` : ""}`);
  if (kept.length) for (const k of kept) log(`  KEEPING ${k.name} - ${k.why}`);
  log(`  op "${OP_NAME}": ${existing ? "already exists - will be replaced" : "to create"}`);
  log(`  op "${CYCLE_OP}": ${cycle ? (cycle.enabled === false ? "already disabled" : "to disable") : "not present"}`);
  if (dryRun) { log("  (dry run - nothing written)"); return; }

  const uid = () => Math.random().toString(36).slice(2, 14);
  const A = (config) => ({ id: uid(), type: "action", config });
  const rule = (left, comparator, right = "") => ({ id: uid(), left, comparator, right });
  const IF = (rules, then, els = []) => ({ id: uid(), type: "if",
    condition: { operator: "AND", rules }, then, else: els });

  const steps = [
    A({ type: "INIT_VAR", name: "$schedPage", expr: `$allItemsById.${SCHEDULE_PAGE}` }),
    A({ type: "INIT_VAR", name: "$schedPageId", expr: "$schedPage.id" }),
    A({ type: "INIT_VAR", name: "$stPageId", expr: `$allItemsById.${stPage.id}.id` }),
    // Source guard, copied from the cycle op: run on a grid-level fire, or on
    // this page's own navigation, and on nobody else's.
    IF([rule("$trigger.sourceOccurrenceId", "IS_EMPTY")],
      [A({ type: "SET_VAR", name: "$mine", value: "literal:1" })],
      [IF([rule("$trigger.sourceOccurrenceId", "IS", "$schedPageId")],
        [A({ type: "SET_VAR", name: "$mine", value: "literal:1" })])]),
    A({ type: "INIT_VAR", name: "$mine2", expr: "$mine" }),
    IF([rule("$mine2", "IS", "1")], [
      { id: uid(), type: "loop", overExpr: "$activePeriodDates", as: "$day", body: [
        { id: uid(), type: "action", config: { type: "FIND", over: "$allContainers",
          itemVar: "$dayCol", itemIdVar: "$dayColId",
          predicate: { operator: "AND", rules: [
            rule("_ancestors", "HAS_ANCESTOR", "$schedPageId"),
            rule(`fields.${FMT}.value`, "IS", "day-col"),
            rule(`fields.${DATE}.value`, "SAME_DAY", "$day"),
          ] } } },
        IF([rule("$dayColId", "IS_NOT_EMPTY")], [
          // The whole change, in two steps: what weekday is this column, and
          // which template says it is that day.
          A({ type: "SET_VAR", name: "$wd", value: "${weekday:$day}" }),
          IF([rule("$wd", "IS_NOT_EMPTY")], [
            { id: uid(), type: "action", config: { type: "FIND", over: "$allContainers",
              itemVar: "$wdTpl", itemIdVar: "$wdTplId",
              predicate: { operator: "AND", rules: [
                rule("_ancestors", "HAS_ANCESTOR", "$stPageId"),
                rule(`fields.${WD}.value`, "IS", "$wd"),
              ] } } },
            IF([rule("$wdTplId", "IS_NOT_EMPTY")], [
              { id: uid(), type: "loop", overExpr: "$wdTpl.occurrences", as: "$tSlotId", body: [
                A({ type: "SET_VAR", name: "$tSlot", value: "$allItemsById.${$tSlotId}" }),
                A({ type: "SET_VAR", name: "$tSlotTime", value: `$tSlot.fields.${TS}.value` }),
                IF([rule("$tSlotTime", "IS_NOT_EMPTY")], [
                  { id: uid(), type: "action", config: { type: "FIND", over: "$allContainers",
                    itemIdVar: "$daySlotId",
                    predicate: { operator: "AND", rules: [
                      rule("parentId", "IS", "$dayColId"),
                      rule(`fields.${TS}.value`, "IS", "$tSlotTime"),
                    ] } } },
                  IF([rule("$daySlotId", "IS_NOT_EMPTY")], [
                    { id: uid(), type: "loop", overExpr: "$tSlot.occurrences", as: "$tItemId", body: [
                      // NO ROW FILTER. The cycle op gated on "carries a Meal or
                      // Movement pick" because its templates also held the daily
                      // routines; 0161 stripped those out, so everything on a
                      // weekday template is by definition specific to that day —
                      // an appointment included, which is the point.
                      A({ type: "APPLY_TEMPLATE", templateRef: "$tItemId", rootParent: "$daySlotId",
                        mode: "merge", defaultFields: { [DATE]: "$day" } }),
                    ] },
                  ]),
                ]),
              ] },
            ]),
          ]),
        ]),
      ] },
    ]),
  ];

  // ---- clear today's stale placement, dumping first -----------------------
  if (stale.length) {
    const dir = resolve(REPO_ROOT, "backups/orphans");
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_0162-stale-cycle-rows.json`);
    writeFileSync(file, JSON.stringify(stale.map(s => s.row), null, 1));
    log(`  dumped ${stale.length} row(s) to ${file}`);
    for (const { row, name } of stale) {
      if (row.parentId) await Occurrence.updateOne({ id: row.parentId, gridId }, { $pull: { occurrences: row.id } });
      await Occurrence.deleteOne({ id: row.id, gridId });
      const others = occs.filter(o => o.moduleId === row.moduleId && o.id !== row.id).length;
      if (!others) await Module.deleteOne({ id: row.moduleId, gridId });
      log(`  cleared ${name} off today's column`);
    }
  }

  // ---- the op, and the cycle's retirement ---------------------------------
  const model = ops.find(o => o.name === CYCLE_OP) || ops.find(o => o.name === "Schedule: Build Schedule");
  await Operation.deleteOne({ gridId, name: OP_NAME });
  await Operation.create({
    id: uid(), gridId, userId: stPage.userId, name: OP_NAME, enabled: true,
    // Trigger surface MIRRORED from the op it replaces rather than restated, so
    // it fires exactly where that one did and the two cannot drift.
    triggerTypes: model?.triggerTypes ?? [], triggerObjects: model?.triggerObjects ?? [],
    targetOccurrenceId: model?.targetOccurrenceId ?? SCHEDULE_PAGE,
    priority: model?.priority ?? 6,
    pipeline: { sources: [], steps },
  });
  log(`  created "${OP_NAME}" (${steps.length} top-level steps)`);
  if (cycle && cycle.enabled !== false) {
    await Operation.updateOne({ id: cycle.id, gridId }, { $set: { enabled: false } });
    log(`  disabled "${CYCLE_OP}"`);
  }
  log("  done - RESTART pm2 and reload; the op writes on load.");
}
