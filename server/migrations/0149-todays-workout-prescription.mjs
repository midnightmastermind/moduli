/**
 * 0149 — one display field per workout, for the day the cycle is actually on.
 *
 * USER, 2026-08-19: *"the goals for working out match what day we are on and shows if i did each of
 * those workouts (one display field per workout)"*, and — asked whether "Thursday" meant a weekday
 * or the rotation — **keep the 5-day cycle.**
 *
 * IT READS TODAY'S COLUMN, NOT THE TEMPLATE, and that is the design decision worth recording.
 * `Schedule: Place Cycle Day` already copies the day's movements onto today's column, so the
 * prescription is ALREADY in the schedule; re-resolving the cycle template by name would be a
 * second source for the same answer, and the two would drift the first time a row is added or
 * removed by hand. Reading the column also means the tile shows what is really on the schedule
 * rather than what the template says ought to be.
 *
 * MEASURED BEFORE CHOOSING THE FIELD COUNT: six is the maximum, on every training day.
 *
 *     Day 1 Push  6 · Day 2 Legs  6 · Day 3 Pull  6 · Day 4 Core  6 · Day 5 Rest  0
 *
 * And Day 4's Run and Stretch are NOT movement rows — they are daily routines placed by
 * `Build Schedule`, carrying no `Movement` pick — so they need no slot here. That retires the
 * open question about them by measurement rather than by asking again.
 *
 * THE SIX SLOTS ARE CLEARED FIRST, EVERY RUN. A Rest day has no movements, and without the clear it
 * would keep showing the previous day's list — the stalest possible kind of wrong, because it looks
 * exactly like a correct answer.
 *
 * THE INDEX IS COMPARED AS TEXT. `$n` is a number and a rule's right-hand side is a string;
 * comparing them is the loose-equality guess `0112` avoided by storing the cycle position as TEXT.
 * The counter is interpolated into `$nTxt` and matched against "1".."6".
 *
 * THE MOVEMENT NAME NEEDS TWO HOPS because `Movement` is a MULTI-select: the stored value is an
 * ARRAY of occurrence ids. `JOIN_ARRAY` reads a VAR (not an expression), so the array goes into one
 * first, and the joined id is then interpolated into `$allItemsById.${...}`. Reading the array as if
 * it were a scalar id is exactly the mistake that made me report 24 healthy picks as dangling
 * earlier today.
 */
export const id = "0149-todays-workout-prescription";
export const describe = "Six Workout display fields showing the current cycle day's movements and whether each is done.";

export const SLOTS = 6;
const GOAL_TILE = "kg860us2nhc";          // the "Workout Goals" tile minted by 0146
const SCHEDULE_PAGE = "llpF10Bda5nu";

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields, ops] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(), Operation.find({ gridId }).lean(),
  ]);
  const byId = new Map(occs.map(o => [o.id, o]));
  const SF = grid?.meta?.scheduleFieldIds || {};
  const inp = (n) => fields.find(f => f.name === n && !f.displayEnabled);
  const MV = inp("Movement")?.id, CMP = inp("Completed")?.id;
  const FMT = SF.scheduleFormatFieldId, DATE = SF.dateFieldId;
  if (!MV || !CMP || !FMT || !DATE) { log("  REFUSING: missing Movement / Completed / schedule field ids"); return; }
  if (!byId.get(GOAL_TILE)) { log(`  REFUSING: the Workout Goals tile ${GOAL_TILE} is not on this grid`); return; }

  // ---- the six display fields -------------------------------------------
  const names = Array.from({ length: SLOTS }, (_, i) => `Workout ${i + 1}`);
  const existing = new Map(fields.filter(f => names.includes(f.name)).map(f => [f.name, f]));
  const toCreate = names.filter(n => !existing.has(n));
  log(`  fields: ${existing.size} present, ${toCreate.length} to create`);

  const tileMod = mods.find(m => m.id === byId.get(GOAL_TILE).moduleId);
  const already = ops.some(o => o.name === "Fitness: Today's Prescription");
  log(`  op "Fitness: Today's Prescription": ${already ? "already exists — will be replaced" : "to create"}`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  const uid = () => Math.random().toString(36).slice(2, 14);
  const fid = {};
  for (const n of names) {
    if (existing.has(n)) { fid[n] = existing.get(n).id; continue; }
    const id2 = uid();
    await Field.create({ id: id2, gridId, userId: tileMod.userId, name: n, type: "text",
      inputEnabled: false, displayEnabled: true, meta: {} });
    fid[n] = id2;
    log(`  created field "${n}"`);
  }

  // ---- bind them to the tile, after whatever it already shows ------------
  const bound = new Set((tileMod.fieldBindings || []).map(b => b.fieldId));
  const add = names.filter(n => !bound.has(fid[n]));
  if (add.length) {
    let order = (tileMod.fieldBindings || []).length;
    await Module.updateOne({ id: tileMod.id, gridId }, { $push: { fieldBindings: {
      $each: add.map(n => ({ fieldId: fid[n], order: order++, role: "display" })) } } });
    log(`  bound ${add.length} field(s) to "${tileMod.label}"`);
  }

  // ---- the pipeline ------------------------------------------------------
  const A = (config) => ({ id: uid(), type: "action", config });
  const rule = (left, comparator, right = "") => ({ id: uid(), left, comparator, right });
  const IF = (rules, then, els = []) => ({ id: uid(), type: "if",
    condition: { operator: "AND", rules }, then, else: els });

  const steps = [
    A({ type: "INIT_VAR", name: "$goalItem", expr: `$allItemsById.${GOAL_TILE}` }),
    A({ type: "INIT_VAR", name: "$schedPage", expr: `$allItemsById.${SCHEDULE_PAGE}` }),
    // Today's column. FIND binds an ARRAY on a multi-match, and UPDATE throws on
    // one — the schedule has exactly one column per date, and the date rule is
    // what keeps it that way.
    { id: uid(), type: "action", config: { type: "FIND", over: "$allContainers",
      itemVar: "$col", itemIdVar: "$colId",
      // A FIND PREDICATE'S `left` IS A BARE RECORD PATH — `fields.x.value`, not
      // `$item.fields.x.value`. The `$item.` form belongs in a LOOP's IF, where
      // the left is a var expression. Getting that backwards makes the predicate
      // match nothing, `$colId` stays empty, and the op reports a clean run
      // having written nothing; the `$colId IS_NOT_EMPTY` guard below is what
      // turned that into "no output" rather than six wrong rows.
      predicate: { operator: "AND", rules: [
        rule(`fields.${FMT}.value`, "IS", "day-col"),
        rule(`fields.${DATE}.value`, "SAME_DAY", "$today"),
      ] } } },
    // CLEAR FIRST — a Rest day must show nothing, not yesterday's list.
    ...names.map(n => A({ type: "UPDATE", path: `$goalItem.fields.${fid[n]}.value`, value: "literal:" })),
    A({ type: "INIT_VAR", name: "$n", value: 0 }),
    // $allItems, NOT $allInstances — the role slice filters on the OCCURRENCE's
    // own `role`, and these rows carry it only on their MODULE, so the slice
    // that should have held them held 889 other things instead. `Total Workouts`
    // loops $allItems for the same reason and works on this grid today.
    { id: uid(), type: "loop", overExpr: "$allItems", as: "$ex", body: [
      // SCOPED THE WAY `Total Workouts` SCOPES — by the SCHEDULE PAGE plus the
      // row's own date — rather than by `HAS_ANCESTOR <the day column>`.
      //
      // The column scope reads better and did not fire: `$colId` binds correctly
      // (verified in the run log) and every row's chain provably reaches the
      // column (slot.parentId IS the column, and the column lists the slot), yet
      // the rule never matched across all 889 instances. Rather than keep
      // guessing at `_ancestors`, this uses the pair already proven on this grid
      // — `Total Workouts` scopes by the Schedule page and works — and adds the
      // date, which the placed rows carry. Same six rows, by a route that is
      // known to run. **The column-scope question is left open, written down in
      // the plan rather than papered over.**
      IF([
        rule("$ex._ancestors", "HAS_ANCESTOR", `${SCHEDULE_PAGE}`),
        rule(`$ex.fields.${DATE}.value`, "SAME_DAY", "$today"),
        rule(`$ex.fields.${MV}.value`, "IS_NOT_EMPTY"),
        rule("$ex.meta.feedSourceId", "IS_EMPTY"),
      ], [
        A({ type: "INCREMENT_VAR", name: "$n", by: 1 }),
        // SET_VAR, NOT INIT_VAR, wherever the value must be RESOLVED.
        // `INIT_VAR` assigns `cfg.value` RAW — no interpolation, no `literal:`
        // stripping — so `value: "${$n}"` stored the six literal characters
        // `${$n}` and every `IS "1"` below was false forever. That is the same
        // defect fixed in `SET_VAR` earlier today and documented one case below
        // it on `MULTIPLY_VAR`: three sibling cases, one mistake. `SET_VAR`
        // resolves `cfg.expr ?? cfg.value`, so it is the one to reach for.
        A({ type: "SET_VAR", name: "$nTxt", value: "${$n}" }),
        // Movement is MULTI-select: the value is an ARRAY of ids.
        A({ type: "INIT_VAR", name: "$mvIds", expr: `$ex.fields.${MV}.value` }),
        A({ type: "JOIN_ARRAY", name: "$mvIds", by: ", ", to: "$mvId" }),
        A({ type: "INIT_VAR", name: "$mv", expr: "$allItemsById.${$mvId}" }),
        A({ type: "INIT_VAR", name: "$mvName", expr: "$mv.moduleLabel" }),
        A({ type: "SET_VAR", name: "$status", value: "literal:not yet" }),
        IF([rule(`$ex.fields.${CMP}.value`, "IS", "true")],
           [A({ type: "SET_VAR", name: "$status", value: "literal:done" })]),
        A({ type: "SET_VAR", name: "$text", value: "${$mvName} — ${$status}" }),
        ...names.map((n, i) => IF([rule("$nTxt", "IS", String(i + 1))],
          [A({ type: "UPDATE", path: `$goalItem.fields.${fid[n]}.value`, value: "$text" })])),
      ]),
    ] },
  ];

  // Trigger surface MIRRORED from an existing tracker rather than restated, so
  // it fires wherever the others do and cannot drift from them.
  const model = ops.find(o => o.name === "Total Workouts");
  const doc = {
    id: uid(), gridId, userId: tileMod.userId,
    name: "Fitness: Today's Prescription",
    enabled: true,
    triggerTypes: model?.triggerTypes ?? [],
    triggerObjects: model?.triggerObjects ?? [],
    targetOccurrenceId: model?.targetOccurrenceId ?? null,
    pipeline: { sources: [], steps },
  };
  await Operation.deleteOne({ gridId, name: "Fitness: Today's Prescription" });
  await Operation.create(doc);
  log(`  created op "Fitness: Today's Prescription" (${steps.length} top-level steps)`);
  log("  RESTART pm2 and reload; the op writes on load.");
}
