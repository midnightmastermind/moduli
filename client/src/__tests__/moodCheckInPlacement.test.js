// Where a mood check-in is FILED — the behavioural half of migration 0339.
//
// User, 2026-09-18: *"those checkins are showing up in todo but it should be in
// tasks completed."*
//
// The migration's own log proves the pipeline was WRITTEN. Only this proves it
// RUNS, and it drives the real executor over the pipeline the migration
// actually ships: the upstream builders composed in shipping order (0087 ->
// 0096 -> 0098) and then `retargetPlacement` on top. A copy of the pipeline
// would test a copy.
//
// EVERY ASSERTION IS A/B'd AGAINST THE PRE-RETARGET PIPELINE, which is the only
// way to know this suite discriminates: the same fixture, the same click, run
// through `before` files the check-in under Todo and run through `after` files
// it under Tasks Completed.
import { describe, it, expect, beforeEach } from "vitest";
import { runMatchingOperations, applyEffectsToLiveOccs } from "../helpers/operationExecutor";
import { buildCheckInTruthPipeline } from "../../../server/migrations/0087-the-check-in-is-the-truth.mjs";
import { buildChildListLookup } from "../../../server/migrations/0096-todo-found-by-child-list.mjs";
import { buildPersistentPipeline } from "../../../server/migrations/0098-moods-persist.mjs";
import { retargetPlacement } from "../../../server/migrations/0339-a-check-in-belongs-under-tasks-completed.mjs";

const GRAPH = "occ-graph";
const MOOD = "fld-mood", DATE = "fld-date", TIMESLOT = "fld-timeslot", COMPLETED = "fld-completed";
const SCHED = "occ-sched";
const TODAY = "2026-09-18", OTHER = "2026-09-17";
const COL_TODAY = "occ-col-today";          // has BOTH a Todo and a Tasks Completed
const COL_NOTODO = "occ-col-notodo";        // 39 of 47 live columns look like this
const TODO_TODAY = "occ-todo-today";
const DONE_TODAY = "occ-done-today", DONE_OTHER = "occ-done-other";
const CHECKIN_SRC = "occ-checkin-src";
const LONELY = "occ-lonely";
// The day-page merge's own marker for this section. Every placed Tasks
// Completed carries it (50 of 50 on the live grid, and nothing else does), which
// is what the retargeted lookup reads.
const DONE_SIG = "daypage:Tasks Completed";

let occurrencesById, modulesById, fieldsById, operations, operationsById, grid;

const before = () => buildPersistentPipeline(
  buildChildListLookup(
    buildCheckInTruthPipeline({
      graphOccId: GRAPH, moodFieldId: MOOD, dateFieldId: DATE, schedulePageOccId: SCHED,
      checkInSourceOccId: CHECKIN_SRC, timeslotFieldId: TIMESLOT, completedFieldId: COMPLETED,
    }),
    { timeslotFieldId: TIMESLOT }),
  { timeslotFieldId: TIMESLOT });

const after = () => retargetPlacement(before(), { doneSignature: DONE_SIG, timeslotFieldId: TIMESLOT }).pipeline;

const makeOp = (pipeline) => ({
  id: "op-mood", name: "Mood: Record Selection", enabled: true, priority: 3,
  targetOccurrenceId: GRAPH, triggerTypes: ["onGraphSelect"],
  triggerObjects: [{ eventType: "onGraphSelect", subjectType: "module", subjectRole: "container", targetId: GRAPH }],
  pipeline,
});

function reset() {
  grid = { _id: "g1", activeFilterValues: {} };
  fieldsById = {
    [MOOD]: { id: MOOD, name: "Mood", type: "occurrence", inputEnabled: true, meta: { multiSelect: true } },
    [DATE]: { id: DATE, name: "Date", type: "date", inputEnabled: true },
    [TIMESLOT]: { id: TIMESLOT, name: "Time Slot", type: "select", inputEnabled: true },
    [COMPLETED]: { id: COMPLETED, name: "Completed", type: "boolean", inputEnabled: true },
  };
  modulesById = {
    "m-graph": { id: "m-graph", role: "container", kind: "graph", label: "Emotions Wheel" },
    "m-col": { id: "m-col", role: "container", kind: "doc", label: "Day Column" },
    "m-page": { id: "m-page", role: "page", kind: "board", label: "Schedule" },
    "m-todo": { id: "m-todo", role: "container", kind: "board", label: "Todo" },
    // The per-day clone, which is what a column actually lists.
    "m-done": { id: "m-done", role: "container", kind: "board", label: "Tasks Completed" },
    "m-emotion": { id: "m-emotion", role: "instance", label: "Lonely" },
    "m-checkin": { id: "m-checkin", role: "instance", label: "Check In",
      fieldBindings: [
        { fieldId: COMPLETED, role: "input" }, { fieldId: MOOD, role: "input" },
        { fieldId: DATE, role: "input", hidden: true },
      ] },
  };
  occurrencesById = {
    [GRAPH]: { id: GRAPH, moduleId: "m-graph", occurrences: [], fields: {}, meta: { graph: { type: "sunburst" } } },
    [COL_TODAY]: { id: COL_TODAY, moduleId: "m-col", occurrences: [GRAPH, TODO_TODAY, DONE_TODAY],
      fields: { [DATE]: { value: TODAY } } },
    [COL_NOTODO]: { id: COL_NOTODO, moduleId: "m-col", occurrences: [GRAPH, DONE_OTHER],
      fields: { [DATE]: { value: OTHER } } },
    [TODO_TODAY]: { id: TODO_TODAY, moduleId: "m-todo", occurrences: [], fields: { [TIMESLOT]: { value: "Todo" } } },
    [DONE_TODAY]: { id: DONE_TODAY, moduleId: "m-done", occurrences: [], fields: {},
      identitySignature: DONE_SIG },
    [DONE_OTHER]: { id: DONE_OTHER, moduleId: "m-done", occurrences: [], fields: {},
      identitySignature: DONE_SIG },
    [CHECKIN_SRC]: { id: CHECKIN_SRC, moduleId: "m-checkin", occurrences: [], fields: {} },
    [SCHED]: { id: SCHED, moduleId: "m-page", occurrences: [] },
    [LONELY]: { id: LONELY, moduleId: "m-emotion", occurrences: [], fields: {} },
  };
  operations = [];
  operationsById = {};
}

// EVERY CLICK STARTS FROM A CLEAN FIXTURE, and that is not tidiness: the op
// TOGGLES. A second click on the same feeling finds the check-in the first one
// made and DELETES it, so two clicks in one test measure the toggle rather than
// the placement — which is exactly how the first draft of this file passed two
// assertions for the wrong reason.
beforeEach(reset);

const ctx = () => ({
  state: {
    grid, gridId: grid._id,
    fields: Object.values(fieldsById), modules: Object.values(modulesById),
    occurrencesById, modulesById, fieldsById, operationsById, operations,
  },
  fieldsById, operationsById, occurrencesById, modulesById,
});

/** Fire one slice click and report which occurrence ended up LISTING the new row. */
function clickWith(pipeline, { column = COL_TODAY, tweak = null } = {}) {
  reset();
  if (tweak) tweak();
  operations = [makeOp(pipeline)];
  operationsById = Object.fromEntries(operations.map((o) => [o.id, o]));
  const tx = {
    type: "GraphSelectOp", occurrenceId: LONELY, containerId: GRAPH,
    ancestorOccurrenceId: column, value: 1, path: ["Sad", "Lonely"], name: "Lonely",
  };
  const updates = runMatchingOperations(operations, "GraphSelectOp", tx, ctx());
  applyEffectsToLiveOccs(occurrencesById, updates);
  const created = updates.filter((u) => u._effect === "CREATE_ITEM");
  const listed = updates
    .filter((u) => u._effect === "UPDATE_OCCURRENCE" && Array.isArray(u.occurrence?.occurrences)
      && u.occurrence.occurrences.length)
    .map((u) => u.occurrence.id);
  return { updates, created, listed };
}

describe("a mood check-in is filed under Tasks Completed", () => {
  it("lists the new check-in under the column's Tasks Completed", () => {
    const { listed } = clickWith(after());
    expect(listed).toContain(DONE_TODAY);
  });

  it("and NOT under the Todo — the A/B that proves the retarget did anything", () => {
    // The control: the shipped-before pipeline files the same click in Todo.
    expect(clickWith(before()).listed).toContain(TODO_TODAY);
    expect(clickWith(before()).listed).not.toContain(DONE_TODAY);

    const { listed } = clickWith(after());
    expect(listed).not.toContain(TODO_TODAY);
  });

  it("files it on a column that has NO Todo — 39 of the 47 live columns", () => {
    // The old lookup found nothing there and the check-in was listed by nobody.
    expect(clickWith(before(), { column: COL_NOTODO }).listed).toEqual([]);
    expect(clickWith(after(), { column: COL_NOTODO }).listed).toContain(DONE_OTHER);
  });

  it("still creates exactly one check-in row — only the LISTING moved", () => {
    expect(clickWith(before()).created).toHaveLength(1);
    expect(clickWith(after()).created).toHaveLength(1);
  });

  it("matches the SIGNATURE, so a renamed board still receives it", () => {
    // The label is one rename away from wrong; the signature is what the
    // day-page merge writes and is why this is not a string match on a heading.
    expect(clickWith(after(), { tweak: () => { modulesById["m-done"].label = "Done Today"; } }).listed)
      .toContain(DONE_TODAY);
  });

  it("REFUSES a board carrying some other signature", () => {
    // The discriminating case: without this the lookup would take any board.
    expect(clickWith(after(), { tweak: () => {
      occurrencesById[DONE_TODAY].identitySignature = "daypage:Highlights";
    } }).listed).not.toContain(DONE_TODAY);
  });
});
