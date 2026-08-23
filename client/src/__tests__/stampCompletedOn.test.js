// "Schedule: Stamp Completed On" — migration 0210.
//
// The op gated on `$trigger.value`, a key no transaction carries, so it had
// stamped NOTHING on 0 of 7,322 occurrences while reporting a clean run every
// time. This drives the REAL executor over the migration's OWN transform, so it
// proves the fix RUNS rather than that it was written.
import { describe, it, expect, beforeEach } from "vitest";
import { runMatchingOperations, applyEffectsToLiveOccs } from "../helpers/operationExecutor";
import { retargetGate } from "../../../server/migrations/0210-stamp-completed-on-reads-the-occurrence.mjs";

const COMPLETED = "fld-completed", COMPLETED_ON = "fld-completed-on";
const ROW = "occ-row";
const TODAY = new Date();
const todayKey = `${TODAY.getFullYear()}-${String(TODAY.getMonth()+1).padStart(2,"0")}-${String(TODAY.getDate()).padStart(2,"0")}`;

// The stored pipeline's exact shape, including the NESTED if — a top-level-only
// transform would report success having changed nothing.
const storedSteps = () => ([
  { id: "s1", type: "action", config: { type: "INIT_VAR", name: "$occ", expr: "$trigger.occurrence" } },
  { id: "s2", type: "if",
    condition: { operator: "AND", rules: [{ id: "r1", left: "$occ.id", comparator: "IS_NOT_EMPTY", right: "" }] },
    then: [
      { id: "s3", type: "if",
        condition: { operator: "AND", rules: [{ id: "r2", left: "$trigger.value", comparator: "IS", right: true }] },
        then: [{ id: "s4", type: "action", config: { type: "UPDATE", path: `$occ.fields.${COMPLETED_ON}.value`, value: "$today" } }],
        else: [{ id: "s5", type: "action", config: { type: "UPDATE", path: `$occ.fields.${COMPLETED_ON}.value`, value: null } }] },
    ],
    else: [] },
]);

let occurrencesById, operations, fieldsById, modulesById, grid, fixed;

beforeEach(() => {
  fixed = retargetGate(storedSteps(), COMPLETED).steps;
  grid = { _id: "g1", activeFilterValues: {} };
  fieldsById = {
    [COMPLETED]: { id: COMPLETED, name: "Completed", type: "boolean" },
    [COMPLETED_ON]: { id: COMPLETED_ON, name: "Completed On", type: "date" },
  };
  modulesById = { "m-task": { id: "m-task", label: "A task", role: "instance",
    fieldBindings: [{ fieldId: COMPLETED }, { fieldId: COMPLETED_ON }] } };
  occurrencesById = { [ROW]: { id: ROW, moduleId: "m-task", occurrences: [],
    fields: { [COMPLETED]: { value: false }, [COMPLETED_ON]: { value: null } } } };
  operations = [{ id: "op-stamp", name: "Schedule: Stamp Completed On", enabled: true, priority: 0,
    triggerTypes: ["onChange"],
    triggerObjects: [{ eventType: "onChange", subjectType: "field", targetId: COMPLETED, priority: 0 }],
    pipeline: { sources: [], steps: fixed } }];
});

const ctx = () => ({
  state: { grid, gridId: grid._id, fields: Object.values(fieldsById), modules: Object.values(modulesById),
           occurrencesById, modulesById, fieldsById,
           operationsById: Object.fromEntries(operations.map(o=>[o.id,o])), operations },
  fieldsById, operationsById: Object.fromEntries(operations.map(o=>[o.id,o])), occurrencesById, modulesById,
});

function tick(value) {
  occurrencesById[ROW].fields[COMPLETED] = { value };
  // The shape CommitHelpers actually emits: a `fields` MAP, no `value` key —
  // which is precisely why the original gate could never pass.
  const tx = { type: "MeasureOp", occurrenceId: ROW, instanceId: "m-task",
               fields: { [COMPLETED]: value }, _ancestorIds: [], _ancestorLabels: [] };
  const updates = runMatchingOperations(operations, "MeasureOp", tx, ctx());
  applyEffectsToLiveOccs(occurrencesById, updates);
  return updates;
}
const stampedOn = () => occurrencesById[ROW].fields[COMPLETED_ON]?.value;

describe("retargetGate", () => {
  it("rewrites the NESTED rule, not just the top level", () => {
    const { steps, patched } = retargetGate(storedSteps(), COMPLETED);
    expect(patched).toBe(1);
    expect(steps[1].then[0].condition.rules[0].left).toBe(`$occ.fields.${COMPLETED}.value`);
  });

  it("returns null when there is nothing to patch — a re-run must be a no-op", () => {
    const once = retargetGate(storedSteps(), COMPLETED).steps;
    expect(retargetGate(once, COMPLETED).steps).toBeNull();
  });

  it("leaves every OTHER rule alone", () => {
    const { steps } = retargetGate(storedSteps(), COMPLETED);
    expect(steps[1].condition.rules[0].left).toBe("$occ.id");
    expect(steps[0].config.expr).toBe("$trigger.occurrence");
  });
});

describe("Schedule: Stamp Completed On — after 0210", () => {
  it("stamps today when the row is ticked", () => {
    expect(stampedOn()).toBeNull();
    tick(true);
    expect(stampedOn()).toBe(todayKey);
  });

  it("CLEARS it when the row is un-ticked", () => {
    tick(true);
    expect(stampedOn()).toBe(todayKey);
    tick(false);
    expect(stampedOn()).toBeNull();
  });

  it("the ORIGINAL pipeline stamps nothing — the A/B, in the suite", () => {
    // `$trigger.value` is undefined on a real field change, so the gate takes
    // its ELSE every time. This is what shipped, and it is why 0 of 7,322
    // occurrences ever carried a value.
    operations[0].pipeline.steps = storedSteps();
    tick(true);
    expect(stampedOn()).toBeNull();
  });
});
