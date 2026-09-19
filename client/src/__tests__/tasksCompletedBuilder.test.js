// "Day Page: Build Tasks Completed" — the behavioural half of migration 0341.
//
// User, 2026-09-18: *"those checkins ... should be in tasks completed."* 0339
// files them there; they did not stay, because this op SWEEPS the container on
// every load. Measured on the live grid, polling the client's own state:
// 5 children at t=7.1s, 0 at t=10.4s, exactly when load-time ops run.
//
// The pipeline here mirrors the live one step for step so the executor has
// something real to run; the two EDITS under test are the migration's own
// exported transforms, applied to it. Every assertion is A/B'd against the
// unpatched pipeline, so each control reproduces the sweep before the fix is
// asserted.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";
import { keepMoodCheckIns, relistMoodCheckIns }
  from "../../../server/migrations/0341-tasks-completed-keeps-the-days-check-ins.mjs";

const MOOD = "fld-mood", DATE = "fld-date", HABIT = "fld-habit", DONE = "fld-completed";
const SIG = "daypage:Tasks Completed";
const BOARD = "occ-day-board", SCHED = "occ-sched";
const COL = "occ-col", TC = "occ-tc";
const TODAY = "2026-09-18";

// The pipeline reads the REAL `$today`, so without a frozen clock this suite
// passed on 2026-09-18 and failed every day after — the fixture rows are dated
// TODAY and stopped matching. Noon LOCAL, so no timezone can roll it a day.
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(`${TODAY}T12:00:00`)); });
afterEach(() => { vi.useRealTimers(); });
const CHECKIN = "occ-checkin", TASK = "occ-task", HABITROW = "occ-habit", JOURNAL = "occ-journal";

let occurrencesById, modulesById, fieldsById, grid;

const act = (type, config, id = `s-${Math.random().toString(36).slice(2, 8)}`) =>
  ({ id, type: "action", config: { type, ...config } });

// Faithful to the live shape, including this op's dialect: the action name
// lives in `config.type`.
const builder = () => ({
  sources: [],
  steps: [
    act("INIT_VAR", { name: "$dayDate", expr: "$today" }),
    act("FIND", {
      over: "$allContainers", itemIdVar: "$dayPageId", itemVar: "$dayPage",
      predicate: { operator: "AND", rules: [
        { left: "parentId", comparator: "IS", right: BOARD },
        { left: `fields.${DATE}.value`, comparator: "SAME_DAY", right: "$dayDate" },
      ] },
    }),
    { id: "col-guard", type: "if",
      condition: { operator: "AND", rules: [{ left: "$dayPageId", comparator: "IS_NOT_EMPTY", right: "" }] },
      then: [
        act("FIND", {
          over: "$allContainers", itemIdVar: "$tcContId", itemVar: "$tcCont",
          predicate: { operator: "AND", rules: [
            { left: "parentId", comparator: "IS", right: "$dayPageId" },
            { left: "identitySignature", comparator: "IS", right: SIG },
          ] },
        }),
        { id: "tc-guard", type: "if",
          condition: { operator: "AND", rules: [{ left: "$tcContId", comparator: "IS_NOT_EMPTY", right: "" }] },
          then: [
            { id: "sweep", type: "loop", overExpr: "$tcCont.occurrences", as: "$kidId", body: [
              act("INIT_VAR", { name: "$kid", expr: "$allItemsById.${$kidId}" }),
              { id: "keep", type: "if",
                condition: { operator: "AND", rules: [
                  { left: `$kid.fields.${DONE}.value`, comparator: "IS", right: "true" },
                  { left: `$kid.fields.${DATE}.value`, comparator: "SAME_DAY", right: "$dayDate" },
                  { left: "$kid._boundFieldIds", comparator: "ARRAY_NOT_INCLUDES", right: HABIT },
                ] },
                then: [],
                else: [act("REMOVE_CHILD", { parentId: "$tcContId", childId: "$kidId" })] },
            ] },
            { id: "add", type: "loop", over: "$allInstances", as: "$task",
              predicate: { operator: "AND", rules: [
                { left: "_ancestors", comparator: "HAS_ANCESTOR", right: SCHED },
                { left: `fields.${DATE}.value`, comparator: "SAME_DAY", right: "$dayDate" },
                { left: `fields.${DONE}.value`, comparator: "IS", right: "true" },
                { left: "_boundFieldIds", comparator: "ARRAY_NOT_INCLUDES", right: HABIT },
              ] },
              body: [act("ADD_CHILD", { parentId: "$tcContId", childId: "$task.id" })] },
          ], else: [] },
      ], else: [] },
  ],
});

const args = { moodFieldId: MOOD, dateFieldId: DATE };
const patched = () => relistMoodCheckIns(keepMoodCheckIns(builder(), args).pipeline, args).pipeline;

beforeEach(() => {
  grid = { _id: "g1", activeFilterValues: {} };
  fieldsById = {
    [MOOD]: { id: MOOD, name: "Mood", type: "occurrence", meta: { multiSelect: true } },
    [DATE]: { id: DATE, name: "Date", type: "date" },
    [DONE]: { id: DONE, name: "Completed", type: "boolean" },
    [HABIT]: { id: HABIT, name: "Habit", type: "boolean" },
  };
  modulesById = {
    "m-board": { id: "m-board", role: "container", kind: "board", label: "Day Pages" },
    "m-col": { id: "m-col", role: "container", kind: "doc", label: "Friday" },
    "m-tc": { id: "m-tc", role: "container", kind: "board", label: "Tasks Completed" },
    "m-page": { id: "m-page", role: "page", kind: "board", label: "Schedule" },
    // A Check In binds Habit — which is the whole reason the sweep took it.
    "m-checkin": { id: "m-checkin", role: "instance", label: "Check In", fieldBindings: [
      { fieldId: DONE }, { fieldId: MOOD }, { fieldId: DATE }, { fieldId: HABIT }] },
    "m-task": { id: "m-task", role: "instance", label: "Task", fieldBindings: [
      { fieldId: DONE }, { fieldId: DATE }] },
    "m-habit": { id: "m-habit", role: "instance", label: "Habit row", fieldBindings: [
      { fieldId: DONE }, { fieldId: DATE }, { fieldId: HABIT }] },
    "m-journal": { id: "m-journal", role: "container", kind: "doc", label: "Journal", fieldBindings: [
      { fieldId: MOOD }, { fieldId: DATE }] },
  };
  occurrencesById = {
    [BOARD]: { id: BOARD, moduleId: "m-board", occurrences: [COL] },
    [COL]: { id: COL, moduleId: "m-col", parentId: BOARD, occurrences: [TC, CHECKIN],
      fields: { [DATE]: { value: TODAY } } },
    [TC]: { id: TC, moduleId: "m-tc", parentId: COL, identitySignature: SIG, occurrences: [CHECKIN, HABITROW],
      fields: {} },
    [CHECKIN]: { id: CHECKIN, moduleId: "m-checkin", parentId: COL, occurrences: [],
      fields: { [DATE]: { value: TODAY }, [MOOD]: { value: ["occ-lonely"] }, [DONE]: { value: true } } },
    // A completed habit: the row the third keep clause exists to exclude, and
    // the control that says this fix did not simply disable the sweep.
    [HABITROW]: { id: HABITROW, moduleId: "m-habit", parentId: COL, occurrences: [],
      fields: { [DATE]: { value: TODAY }, [DONE]: { value: true } } },
    [SCHED]: { id: SCHED, moduleId: "m-page", occurrences: [TASK, JOURNAL] },
    [TASK]: { id: TASK, moduleId: "m-task", parentId: SCHED, occurrences: [],
      fields: { [DATE]: { value: TODAY }, [DONE]: { value: true } } },
    // Carries a Mood AND today's date, but lives under the Schedule page — the
    // row the ancestor scope has to keep out.
    [JOURNAL]: { id: JOURNAL, moduleId: "m-journal", parentId: SCHED, occurrences: [],
      fields: { [DATE]: { value: TODAY }, [MOOD]: { value: ["occ-lonely"] } } },
  };
});

const ctx = () => ({
  state: {
    grid, gridId: grid._id,
    fields: Object.values(fieldsById), modules: Object.values(modulesById),
    occurrencesById, modulesById, fieldsById, operationsById: {}, operations: [],
  },
  fieldsById, occurrencesById, modulesById, operationsById: {}, operations: [],
});

function run(pipeline) {
  const out = executePipeline(
    { id: "op-build", name: "Day Page: Build Tasks Completed", pipeline },
    ctx(), { type: "LoadOp" }, {});
  const effects = Array.isArray(out) ? out : (out?.effects || out?.updates || []);
  const listWrites = effects.filter((e) => e._effect === "UPDATE_OCCURRENCE"
    && e.occurrence?.id === TC && Array.isArray(e.occurrence.occurrences));
  // The container's final child list, as the run leaves it.
  return listWrites.length ? listWrites[listWrites.length - 1].occurrence.occurrences
    : (ctx().occurrencesById[TC].occurrences);
}

describe("the builder stops sweeping the day's mood check-ins", () => {
  it("SWEEPS the check-in before the fix — the measurement, reproduced", () => {
    // The control. Without it "the check-in is there" also passes against a
    // build where the sweep never ran at all.
    expect(run(builder())).not.toContain(CHECKIN);
  });

  it("keeps it after the fix", () => {
    expect(run(patched())).toContain(CHECKIN);
  });

  it("STILL sweeps a completed habit — the sweep was narrowed, not disabled", () => {
    expect(run(builder())).not.toContain(HABITROW);
    expect(run(patched())).not.toContain(HABITROW);
  });

  it("still adds the day's completed task from the Schedule page", () => {
    expect(run(patched())).toContain(TASK);
  });

  it("does NOT pull in the journal, which carries a Mood for the same day", () => {
    expect(run(patched())).not.toContain(JOURNAL);
  });

  it("RE-LISTS a check-in the container has lost", () => {
    // This is what makes the container self-healing: a single ADD_CHILD from
    // the Mood op is a write nobody repeats.
    occurrencesById[TC].occurrences = [];
    expect(run(builder())).not.toContain(CHECKIN);
    expect(run(patched())).toContain(CHECKIN);
  });

  it("sweeps a mood row dated some OTHER day", () => {
    occurrencesById[CHECKIN].fields[DATE] = { value: "2026-09-17" };
    expect(run(patched())).not.toContain(CHECKIN);
  });
});
