// server/migrations/0079-mood-records-the-clicked-day.mjs
//
// Clicking the emotions wheel records NOTHING, and never has.
//
// User, 2026-08-11: "it should be lighting up the moods i select too" — on the
// wheel. The highlight is a SYMPTOM. Measured on poms grid before writing a
// line: **0 moods have ever been recorded** and `meta.graph.highlight` is null.
// `Mood: Record Selection` fires correctly; its pipeline exits with zero
// effects.
//
// ── WHY (two linked defects, both measured through the real executor) ────────
//
// 1. `$day` IS A PERIOD OBJECT AND `SAME_DAY` CANNOT READ ONE. 0046 resolved
//    the day from the graph's own `_effectiveFilter`, which is the date
//    picker's shape — `{value:"2026-08-11", unit:"day", span:2, kind:"range"}`.
//    Driving the real comparator over live data, with a control proving the
//    probe discriminates:
//
//      SAME_DAY(date, <period object>)    false   <- every candidate fails here
//      SAME_DAY(date, "2026-08-11")       true
//      DATE_IN_PERIOD(date, <period obj>) true
//      DATE_IN_PERIOD(date, wrong day)    false   <- control
//
//    So all 10 Mood-binding occurrences failed the date rule — INCLUDING the
//    two dated exactly 2026-08-11 — `$moodHost` bound nothing, and the guard
//    `IF $moodHost IS_NOT_EMPTY` swallowed it silently. This is the class
//    2026-06-03 records for `Table: Build` / `Canvas: Build`, both of which
//    were migrated SAME_DAY -> DATE_IN_PERIOD for exactly this reason. 0046
//    was written afterwards and never got that treatment.
//
// 2. THE OBVIOUS FIX THROWS, which is why it is not the fix. Swapping in
//    DATE_IN_PERIOD makes the span-2 range match THREE journals; FIND returns
//    an ARRAY on multi-match and the executor throws
//    `$moodHost is not a record (no .id)`. A silent no-op becomes a crash.
//
// ── THE ROOT CAUSE UNDER BOTH ───────────────────────────────────────────────
//
// 0068 unified the wheel into ONE occurrence multi-parented into every day
// column. That fixed "a click matches nothing" and left the wheel with NO
// SINGLE DAY: `buildParentMap` keys child -> ONE parent on a last-writer-wins
// scan, so every data-side ancestor walk resolves an arbitrary one of its
// parents. The day a click recorded to was never deterministic.
//
// User's call (asked, not guessed — this is a real journal): **the day column
// I clicked in.** So the client now reports the render context
// (`$trigger.ancestorOccurrenceId`, ContainerGraph) and this op reads the day
// off THAT column. `_effectiveFilter` is not consulted for it at all.
//
// ── AND THE PREMISE THAT MEASUREMENT FALSIFIED ──────────────────────────────
//
// Scoping the HOST to the clicked column was the obvious next step and is
// WRONG: the day columns hold zero Mood-binding occurrences. The journals live
// in the SCHEDULE, under a 9:00pm slot:
//
//   9937acfa Journal 2026-08-11  9:00pm < Schedule - Tue Aug 11 < Schedule   healthy
//   0bd186c8 Journal 2026-08-11  9:00pm                                      ORPHAN
//   e94b2cb1 Journal 2026-07-30  (no parent at all)                          ORPHAN
//
// The column supplies the DATE; the Schedule supplies the HOST. Scoping the
// find with `HAS_ANCESTOR <Schedule page>` is what makes the result single and
// deterministic — the two orphans have no path to it, so the array-throw in
// defect 2 cannot recur. That scoping is the same idiom every tracker on this
// grid already uses. The cost, stated plainly: a journal kept OUTSIDE the
// Schedule would no longer be found. Finding it by BINDING (never by label) is
// unchanged, so renaming the journal still cannot break this.
//
// The highlight needs no separate repair. It is written from the same `$moods`
// value the field gets — one truth, written twice — and the renderer already
// lights up whatever ids sit in `meta.graph.highlight`.
import { randomUUID as uuid } from "node:crypto";

export const id = "0079-mood-records-the-clicked-day";
export const describe =
  "Record a clicked feeling on the day column it was clicked in, and find the day's " +
  "journal deterministically (scoped to the Schedule) so the write cannot bind an array.";

/**
 * PURE — the repaired pipeline. Exported so the behavioural test drives THIS,
 * never a copy: a test against a transcribed pipeline proves nothing about
 * what ships.
 *
 * `$trigger` carries what ContainerGraph reports for a click:
 *   { occurrenceId, containerId, ancestorOccurrenceId, value, path, name }
 */
export function buildRecordSelectionPipeline({ graphOccId, moodFieldId, dateFieldId, schedulePageOccId }) {
  return {
    sources: [],
    steps: [
      // Every var is declared before use. A FIND that matches nothing does not
      // bind its itemVar, and reading an unbound var THROWS — so the guard
      // meant to handle "nothing found" never runs. Declaring up front turns
      // every miss into a value a guard can test. (0046's lesson, kept.)
      { id: uuid(), type: "action", actionType: "INIT_VAR",
        config: { name: "$picked", expr: "$trigger.occurrenceId" } },
      { id: uuid(), type: "action", actionType: "INIT_VAR", config: { name: "$graph", expr: "literal:" } },
      { id: uuid(), type: "action", actionType: "INIT_VAR", config: { name: "$col", expr: "literal:" } },
      { id: uuid(), type: "action", actionType: "INIT_VAR", config: { name: "$day", expr: "literal:" } },
      { id: uuid(), type: "action", actionType: "INIT_VAR", config: { name: "$moodHost", expr: "literal:" } },
      { id: uuid(), type: "action", actionType: "INIT_VAR", config: { name: "$moods", expr: "json:[]" } },

      { id: uuid(), type: "if",
        // `condition` + `operator` — an IF step reads step.condition, and an
        // unrecognised key falls back to an EMPTY AND, which evaluates TRUE.
        // A mis-keyed guard does not fail closed; it runs its branch
        // unconditionally.
        condition: { operator: "AND", rules: [
          { left: "$picked", comparator: "IS_NOT_EMPTY", right: null },
        ]},
        then: [
          // The graph itself — the highlight is written back onto it.
          { id: uuid(), type: "action", actionType: "FIND",
            config: {
              over: "$allOccurrences", itemVar: "$graph",
              predicate: { conjunction: "AND", rules: [
                { left: "id", comparator: "IS", right: graphOccId },
              ]},
            } },

          // ── THE DAY: the column the click happened in ────────────────────
          // Its OWN Date field, which is a plain "YYYY-MM-DD" string. That is
          // what dissolves defect 1 rather than patching around it: there is
          // no period object in the comparison at all.
          { id: uuid(), type: "action", actionType: "FIND",
            config: {
              over: "$allOccurrences", itemVar: "$col",
              predicate: { conjunction: "AND", rules: [
                { left: "id", comparator: "IS", right: "$trigger.ancestorOccurrenceId" },
              ]},
            } },
          { id: uuid(), type: "if",
            condition: { operator: "AND", rules: [
              { left: "$col", comparator: "IS_NOT_EMPTY", right: null },
            ]},
            then: [
              { id: uuid(), type: "action", actionType: "SET_VAR",
                config: { name: "$day", expr: `$col.fields.${dateFieldId}.value` } },
            ],
            else: [] },

          // Fallbacks, narrowest first, for a graph that is NOT in a day column
          // (an older client that reports no render context, or a wheel placed
          // somewhere else). `.value` FIRST unwraps the period object into its
          // day — reading the object whole is exactly what broke this.
          { id: uuid(), type: "if",
            condition: { operator: "AND", rules: [{ left: "$day", comparator: "IS_EMPTY", right: null }]},
            then: [
              { id: uuid(), type: "action", actionType: "SET_VAR",
                config: { name: "$day", expr: `$graph._effectiveFilter.${dateFieldId}.value` } },
            ],
            else: [] },
          { id: uuid(), type: "if",
            condition: { operator: "AND", rules: [{ left: "$day", comparator: "IS_EMPTY", right: null }]},
            then: [
              { id: uuid(), type: "action", actionType: "SET_VAR",
                config: { name: "$day", expr: `$graph._effectiveFilter.${dateFieldId}` } },
            ],
            else: [] },
          { id: uuid(), type: "if",
            condition: { operator: "AND", rules: [{ left: "$day", comparator: "IS_EMPTY", right: null }]},
            then: [
              { id: uuid(), type: "action", actionType: "SET_VAR",
                config: { name: "$day", expr: "$today" } },
            ],
            else: [] },

          // ── THE HOST that carries the mood for that day ──────────────────
          // Found by BINDING, never by label, so renaming the journal cannot
          // break recording a feeling. Scoped to the Schedule page because the
          // journals live there and the orphans do not — that is what keeps
          // this to exactly ONE match, and a multi-match binds an ARRAY that
          // UPDATE refuses ("not a record (no .id)").
          //
          // SAME_DAY, not DATE_IN_PERIOD: `$day` is now always a single day, so
          // the strict comparator is the honest one. DATE_IN_PERIOD would
          // silently re-admit a multi-day range and the array-throw with it.
          { id: uuid(), type: "action", actionType: "FIND",
            config: {
              over: "$allOccurrences", itemVar: "$moodHost",
              predicate: { conjunction: "AND", rules: [
                { left: "_boundFieldIds", comparator: "ARRAY_INCLUDES", right: moodFieldId },
                { left: `fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$day" },
                { left: "_ancestors", comparator: "HAS_ANCESTOR", right: schedulePageOccId },
              ]},
            } },

          { id: uuid(), type: "if",
            condition: { operator: "AND", rules: [
              { left: "$moodHost", comparator: "IS_NOT_EMPTY", right: null },
            ]},
            then: [
              // UNION, not replace. Mood is a multiselect because a day holds
              // several feelings; re-picking one must not duplicate it.
              { id: uuid(), type: "action", actionType: "INIT_VAR",
                config: { name: "$moods", expr: `$moodHost.fields.${moodFieldId}.value` } },
              // `with`, not `expr` — MERGE_ARRAY's incoming key. A wrong key
              // reads as an empty merge and silently records nothing.
              { id: uuid(), type: "action", actionType: "MERGE_ARRAY",
                config: { name: "$moods", with: "$picked", unique: true } },
              { id: uuid(), type: "action", actionType: "UPDATE",
                config: { path: `$moodHost.fields.${moodFieldId}.value`, value: "$moods" } },

              // The highlight holds the SAME ids as the field — one truth,
              // written from the other. The graph renders this and decides
              // nothing itself.
              { id: uuid(), type: "action", actionType: "UPDATE",
                config: { path: "$graph.meta.graph.highlight", value: "$moods" } },
            ],
            else: [] },
        ],
        else: [] },
    ],
  };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;

  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "(?)";

  // Resolve by TYPE as well as name: this grid has carried duplicate field
  // names before, and a name-only match picks whichever Mongo returns first.
  const dateField = fields.find((f) => f.name === "Date" && f.type === "date");
  const moodField = fields.find((f) => f.name === "Mood");
  if (!dateField || !moodField) {
    log(`REFUSING: missing field (Date=${!!dateField} Mood=${!!moodField}) — nothing written.`);
    return;
  }

  const graphs = occs.filter((o) => modById.get(o.moduleId)?.kind === "graph");
  if (graphs.length !== 1) {
    // 0068 unified six wheels into one. More than one here means that
    // unification has come undone, and picking one would be a guess about
    // which wheel the user is clicking.
    log(`REFUSING: expected exactly 1 graph occurrence, found ${graphs.length} — nothing written.`);
    return;
  }
  const wheel = graphs[0];

  // The Schedule PAGE — the scope that makes the host find single. Resolved by
  // role+label rather than a baked id so a reseeded grid resolves its own.
  const schedulePage = occs.find((o) => {
    const m = modById.get(o.moduleId);
    return m?.role === "page" && (o.label ?? m?.label) === "Schedule";
  });
  if (!schedulePage) {
    log(`REFUSING: no Schedule page found — the host find would be unscoped and could bind an array.`);
    return;
  }

  const op = await Operation.findOne({ gridId, name: "Mood: Record Selection" }).lean();
  if (!op) {
    log(`REFUSING: "Mood: Record Selection" not found — 0046 has not run on this grid.`);
    return;
  }

  // Report against a NAMED expectation, not a count: a dry run whose prose
  // reads plausibly while the selector matched the wrong thing is the 0035
  // class, and a count would never have caught it.
  log(`wheel            ${wheel.id.slice(0, 8)} (${nameOf(wheel)})`);
  log(`Schedule page    ${schedulePage.id.slice(0, 8)} (${nameOf(schedulePage)})`);
  log(`Date field       ${dateField.id}  Mood field ${moodField.id}`);

  const hosts = occs.filter((o) =>
    (modById.get(o.moduleId)?.fieldBindings || []).some((b) => b.fieldId === moodField.id));
  log(`Mood-binding occurrences: ${hosts.length}`);

  const pipeline = buildRecordSelectionPipeline({
    graphOccId: wheel.id,
    moodFieldId: moodField.id,
    dateFieldId: dateField.id,
    schedulePageOccId: schedulePage.id,
  });

  // Idempotent by CONTENT, not by a marker: re-running rewrites the same
  // pipeline, and a pipeline that already matches is left alone so `updatedAt`
  // does not move for nothing.
  const already = JSON.stringify(op.pipeline?.steps || []).includes(`"right":"${schedulePage.id}"`)
    && JSON.stringify(op.pipeline?.steps || []).includes("$trigger.ancestorOccurrenceId");
  if (already) {
    log(`pipeline already carries the clicked-column resolution and the Schedule scope — no change.`);
    return;
  }

  if (dryRun) {
    log(`WOULD rewrite "Mood: Record Selection" pipeline:`);
    log(`   $day  <- the clicked column's own Date field ($trigger.ancestorOccurrenceId)`);
    log(`   host  <- binds Mood AND SAME_DAY $day AND HAS_ANCESTOR ${schedulePage.id.slice(0, 8)}`);
    log(`   (was: $day <- graph._effectiveFilter (a period object), host unscoped)`);
    return;
  }

  await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
  log(`rewrote "Mood: Record Selection" — day from the clicked column, host scoped to the Schedule.`);
}
