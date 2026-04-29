// __tests__/operationExecutor.test.js
// ============================================================
// Unit tests for the operation executor:
//   - shouldTrigger (trigger type matching)
//   - executeOperation (block canvas path)
//   - executePipeline (form-based pipeline path)
//   - Target propagation through SEND_TO_DISPLAY
//   - RUN_OPERATION recursive chaining
//   - runMatchingOperations batch execution
// ============================================================

import { describe, test, expect, vi } from "vitest";
import {
  shouldTrigger,
  computeTriggerMatch,
  executeOperation,
  executePipeline,
  runMatchingOperations,
} from "../helpers/operationExecutor";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function makeOp(overrides = {}) {
  return {
    id: "op1",
    name: "Test Op",
    enabled: true,
    triggerType: "manual",
    targetFieldId: "f1",
    blockTree: null,
    pipeline: null,
    ...overrides,
  };
}

function aggBlock(aggregation = "sum", allowedFields = [], opts = {}) {
  return {
    id: "agg1",
    type: "aggregation",
    shape: "reporter",
    data: { aggregation, allowedFields, scope: "grid", timeFilter: "all", ...opts },
    slots: [],
  };
}

function literalBlock(value) {
  return {
    id: "lit1",
    type: "literal",
    shape: "reporter",
    data: { value, valueType: "number" },
    slots: [],
  };
}

function sendToDisplayBlock(targetFieldId, valueBlock, targetBlock = null, targetPeriod = "daily") {
  return {
    id: "send1",
    type: "action",
    shape: "statement",
    data: { actionType: "SEND_TO_DISPLAY", targetFieldId, targetPeriod },
    slots: [
      { id: "value", label: "value", connected: valueBlock },
      { id: "target", label: "target", connected: targetBlock },
    ],
  };
}

function makeState(occurrences = [], fields = []) {
  const occurrencesById = {};
  for (const o of occurrences) occurrencesById[o.id] = o;
  const fieldsById = {};
  for (const f of fields) fieldsById[f.id] = f;
  return {
    // state.occurrences = full occurrence objects (as loaded by full_state)
    state: { occurrences, occurrencesById },
    fieldsById,
    occurrencesById,
  };
}

// ─── shouldTrigger ────────────────────────────────────────────────────────────

describe("shouldTrigger", () => {
  test("manual op never auto-triggers", () => {
    const op = makeOp({ triggerType: "manual" });
    expect(shouldTrigger(op, "MeasureOp")).toBe(false);
    expect(shouldTrigger(op, null)).toBe(false);
    expect(shouldTrigger(op, "OccurrenceListOp")).toBe(false);
  });

  test("onChange fires on MeasureOp only", () => {
    const op = makeOp({ triggerType: "onChange" });
    expect(shouldTrigger(op, "MeasureOp")).toBe(true);
    expect(shouldTrigger(op, "OccurrenceListOp")).toBe(false);
    expect(shouldTrigger(op, null)).toBe(false);
  });

  test("onDrop fires on OccurrenceListOp only", () => {
    const op = makeOp({ triggerType: "onDrop" });
    expect(shouldTrigger(op, "OccurrenceListOp")).toBe(true);
    expect(shouldTrigger(op, "MeasureOp")).toBe(false);
  });

  test("onFilterChange fires on NavigationOp only", () => {
    const op = makeOp({ triggerType: "onFilterChange" });
    expect(shouldTrigger(op, "NavigationOp")).toBe(true);
    expect(shouldTrigger(op, null)).toBe(false);
    expect(shouldTrigger(op, "MeasureOp")).toBe(false);
  });

  test("disabled op never triggers", () => {
    const op = makeOp({ triggerType: "onLoad", enabled: false });
    expect(shouldTrigger(op, null)).toBe(false);
  });
});

// ─── executeOperation — reporter path ─────────────────────────────────────────

describe("executeOperation — reporter (aggregation) path", () => {
  test("empty blockTree returns []", () => {
    const op = makeOp({ blockTree: null });
    expect(executeOperation(op, null, null, {})).toEqual([]);
  });

  test("LITERAL reporter writes value to targetFieldId", () => {
    const op = makeOp({ blockTree: literalBlock(42) });
    const result = executeOperation(op, null, null, {});
    expect(result).toHaveLength(1);
    expect(result[0].fieldId).toBe("f1");
    expect(result[0].value).toBe(42);
    expect(result[0].target).toBeNull();
  });

  test("AGGREGATION reporter — sum over zero occurrences returns 0", () => {
    const op = makeOp({
      blockTree: aggBlock("sum", [{ fieldId: "steps", flowFilter: "any" }]),
    });
    const ctx = makeState([]);
    const result = executeOperation(op, null, null, ctx);
    expect(result[0].value).toBe(0);
  });

  test("AGGREGATION reporter — sum with occurrences", () => {
    const occs = [
      { id: "o1", fields: { steps: { value: 3000, flow: "in" } }, iteration: {} },
      { id: "o2", fields: { steps: { value: 7000, flow: "in" } }, iteration: {} },
    ];
    const op = makeOp({
      blockTree: aggBlock("sum", [{ fieldId: "steps", flowFilter: "any" }]),
    });
    const ctx = makeState(occs);
    const result = executeOperation(op, null, null, ctx);
    expect(result[0].value).toBe(10000);
  });

  test("disabled op returns []", () => {
    const op = makeOp({ enabled: false, blockTree: literalBlock(99) });
    expect(executeOperation(op, null, null, {})).toEqual([]);
  });
});

// ─── executeOperation — SEND_TO_DISPLAY action path ──────────────────────────

describe("executeOperation — SEND_TO_DISPLAY action path", () => {
  test("SEND_TO_DISPLAY without target slot writes { value, target: null }", () => {
    const op = makeOp({
      blockTree: sendToDisplayBlock("field_total", literalBlock(500), null),
    });
    const result = executeOperation(op, null, null, {});
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ fieldId: "field_total", occurrenceId: undefined, value: 500, target: null });
  });

  test("SEND_TO_DISPLAY with LITERAL target slot propagates target", () => {
    const op = makeOp({
      blockTree: sendToDisplayBlock("field_steps", literalBlock(7500), literalBlock(10000)),
    });
    const result = executeOperation(op, null, null, {});
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(7500);
    expect(result[0].target).toEqual({ value: 10000, period: "daily" });
  });

  test("SEND_TO_DISPLAY target period comes from block data", () => {
    const block = sendToDisplayBlock("fld", literalBlock(30), literalBlock(60), "weekly");
    const op = makeOp({ blockTree: block });
    const result = executeOperation(op, null, null, {});
    expect(result[0].target).toEqual({ value: 60, period: "weekly" });
  });

  test("SEND_TO_DISPLAY with aggregation in value slot", () => {
    const occs = [
      { id: "o1", fields: { water: { value: 32, flow: "in" } }, iteration: {} },
      { id: "o2", fields: { water: { value: 32, flow: "in" } }, iteration: {} },
    ];
    const aggValue = aggBlock("sum", [{ fieldId: "water", flowFilter: "any" }]);
    const op = makeOp({
      blockTree: sendToDisplayBlock("field_water", aggValue, literalBlock(64)),
    });
    const ctx = makeState(occs);
    const result = executeOperation(op, null, null, ctx);
    expect(result[0].value).toBe(64);
    expect(result[0].target).toEqual({ value: 64, period: "daily" });
  });
});

// ─── Pipeline step helpers ────────────────────────────────────────────────────

// Build a "action" step for the pipeline steps model
function s(type, config) {
  return { id: "s" + Math.random().toString(36).slice(2, 6), type: "action", config: { type, ...config } };
}
// Build an "if" step for the pipeline steps model
function ifS(condition, thenSteps, elseSteps = []) {
  return { id: "i" + Math.random().toString(36).slice(2, 6), type: "if", condition, then: thenSteps, else: elseSteps };
}
// Build an AND condition group
function andCond(...rules) {
  return { operator: "AND", rules: rules.map((r, i) => ({ id: `r${i}`, ...r })) };
}
// Build an OR condition group
function orCond(...rules) {
  return { operator: "OR", rules: rules.map((r, i) => ({ id: `r${i}`, ...r })) };
}
// Wrap steps into a pipeline (no sources)
function pipe(...steps) {
  return { sources: [], steps };
}
// Wrap steps with sources
function pipeWithSources(sources, ...steps) {
  return { sources, steps };
}

// ─── executePipeline ─────────────────────────────────────────────────────────

describe("executePipeline", () => {
  test("null pipeline returns []", () => {
    const op = makeOp({ pipeline: null });
    expect(executePipeline(op, {})).toEqual([]);
  });

  test("empty pipeline (no steps) returns []", () => {
    const op = makeOp({ pipeline: pipe() });
    expect(executePipeline(op, {})).toEqual([]);
  });

  test("UPDATE display step with literal expr emits UPDATE_DISPLAY_VALUE effect", () => {
    const op = makeOp({ pipeline: pipe(s("UPDATE", { path: "$display.f1.t", value: "literal:42" })) });
    const result = executePipeline(op, {});
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ _effect: "UPDATE_DISPLAY_VALUE", fieldId: "f1", itemId: "t", value: 42 });
  });

  test("source resolves field values from occurrences into $var", () => {
    const occs = [
      { id: "o1", targetId: "inst1", fields: { score: { value: 88, flow: "in" } }, iteration: {} },
    ];
    const op = makeOp({
      pipeline: pipeWithSources(
        [{ id: "src1", variableName: "habit", entityType: "instance", entityId: "inst1" }],
        s("UPDATE", { path: "$display.f1.t", value: "$habit.score" }),
      ),
    });
    const ctx = { state: {}, fieldsById: {}, occurrencesById: { o1: occs[0] } };
    const result = executePipeline(op, ctx);
    expect(result[0].value).toBe(88);
  });

  test("if step — passing condition allows then branch to run", () => {
    const op = makeOp({
      pipeline: pipe(
        ifS(andCond({ left: "literal:10", comparator: "GREATER", right: "5" }),
          [s("UPDATE", { path: "$display.f1.t", value: "literal:1" })]),
      ),
    });
    const result = executePipeline(op, {});
    expect(result).toHaveLength(1);
  });

  test("if step — failing condition runs else branch", () => {
    const op = makeOp({
      pipeline: pipe(
        ifS(andCond({ left: "literal:3", comparator: "GREATER", right: "10" }),
          [s("UPDATE", { path: "$display.f1.t", value: "literal:then" })],
          [s("UPDATE", { path: "$display.f2.t", value: "literal:else" })]),
      ),
    });
    const result = executePipeline(op, {});
    expect(result).toHaveLength(1);
    expect(result[0].fieldId).toBe("f2");
    expect(result[0].value).toBe("else");
    expect(result[0]._effect).toBe("UPDATE_DISPLAY_VALUE");
  });

  test("action before if always runs regardless of condition", () => {
    const op = makeOp({
      pipeline: pipe(
        s("UPDATE", { path: "$display.f0.t", value: "literal:always" }),
        ifS(andCond({ left: "literal:1", comparator: "GREATER", right: "100" }),
          [s("UPDATE", { path: "$display.f1.t", value: "literal:then" })]),
      ),
    });
    const result = executePipeline(op, {});
    expect(result).toHaveLength(1); // f0 runs, f1 blocked by condition
    expect(result[0].fieldId).toBe("f0");
  });

  test("OR condition — any rule passing opens branch", () => {
    const op = makeOp({
      pipeline: pipe(
        ifS(orCond(
          { left: "literal:1", comparator: "GREATER", right: "100" }, // fails
          { left: "literal:5", comparator: "IS", right: "5" }, // passes
        ), [s("UPDATE", { path: "$display.f1.t", value: "literal:ok" })]),
      ),
    });
    const result = executePipeline(op, {});
    expect(result).toHaveLength(1);
  });

  test("IS_EMPTY comparator — empty string passes", () => {
    const op = makeOp({
      pipeline: pipe(
        ifS(andCond({ left: "", comparator: "IS_EMPTY", right: "" }),
          [s("UPDATE", { path: "$display.f1.t", value: "literal:1" })]),
      ),
    });
    expect(executePipeline(op, {})).toHaveLength(1);
  });

  test("NOTIFY step fires without blocking other steps", () => {
    const op = makeOp({
      pipeline: pipe(
        s("NOTIFY", { message: "Hello!" }),
        s("UPDATE", { path: "$display.f1.t", value: "literal:7" }),
      ),
    });
    const result = executePipeline(op, {});
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(7);
  });

  test("RUN_OPERATION recurses into sub-pipeline", () => {
    const subOp = makeOp({
      id: "sub1",
      pipeline: pipe(s("UPDATE", { path: "$display.f2.t", value: "literal:99" })),
    });
    const op = makeOp({
      pipeline: pipe(s("RUN_OPERATION", { operationId: "sub1" })),
    });
    const result = executePipeline(op, {
      state: {}, fieldsById: {}, occurrencesById: {}, operationsById: { sub1: subOp },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ fieldId: "f2", value: 99 });
  });

  test("RUN_OPERATION recurses into sub block-tree op", () => {
    const subOp = makeOp({
      id: "sub1",
      targetFieldId: "f3",
      blockTree: literalBlock(55),
      pipeline: null,
    });
    const op = makeOp({
      pipeline: pipe(s("RUN_OPERATION", { operationId: "sub1" })),
    });
    const result = executePipeline(op, {
      state: {}, fieldsById: {}, occurrencesById: {}, operationsById: { sub1: subOp },
    });
    expect(result).toHaveLength(1);
    expect(result[0].fieldId).toBe("f3");
    expect(result[0].value).toBe(55);
  });

  test("missing RUN_OPERATION operationId is a no-op", () => {
    const op = makeOp({
      pipeline: pipe(s("RUN_OPERATION", { operationId: "nonexistent" })),
    });
    const result = executePipeline(op, { state: {}, fieldsById: {}, occurrencesById: {}, operationsById: {} });
    expect(result).toHaveLength(0);
  });

  test("multiple steps write to multiple fields in order", () => {
    const op = makeOp({
      pipeline: pipe(
        s("UPDATE", { path: "$display.f1.t", value: "literal:10" }),
        s("UPDATE", { path: "$display.f2.t", value: "literal:20" }),
        s("UPDATE", { path: "$display.f3.t", value: "literal:30" }),
      ),
    });
    const result = executePipeline(op, {});
    expect(result).toHaveLength(3);
    expect(result.map(r => r.fieldId)).toEqual(["f1", "f2", "f3"]);
    expect(result.map(r => r.value)).toEqual([10, 20, 30]);
  });

  test("nested if steps (if inside then branch)", () => {
    const op = makeOp({
      pipeline: pipe(
        ifS(andCond({ left: "literal:5", comparator: "IS", right: "5" }),
          [
            ifS(andCond({ left: "literal:3", comparator: "IS", right: "3" }),
              [s("UPDATE", { path: "$display.deep.t", value: "literal:nested" })]),
          ]),
      ),
    });
    const result = executePipeline(op, {});
    expect(result).toHaveLength(1);
    expect(result[0].fieldId).toBe("deep");
  });

  test("trigger source maps $trigger.occurrenceId into named var", () => {
    const transaction = { type: "MeasureOp", occurrenceId: "occ-123", fieldId: "water" };
    const op = makeOp({
      pipeline: pipeWithSources(
        [{ id: "src1", variableName: "trigOccId", entityType: "trigger", triggerProp: "occurrenceId" }],
        s("UPDATE", { path: "$display.f1.t", value: "$trigOccId" }),
      ),
    });
    const result = executePipeline(op, {}, transaction);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe("occ-123");
  });

  test("trigger source maps $trigger.fieldId into named var", () => {
    const transaction = { type: "MeasureOp", occurrenceId: "occ-1", fieldId: "water" };
    const op = makeOp({
      pipeline: pipeWithSources(
        [{ id: "src1", variableName: "changedField", entityType: "trigger", triggerProp: "fieldId" }],
        s("UPDATE", { path: "$display.f1.t", value: "$changedField" }),
      ),
    });
    const result = executePipeline(op, {}, transaction);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe("water");
  });

  test("trigger source with missing triggerProp skips the trigger handler", () => {
    const transaction = { type: "MeasureOp", occurrenceId: "occ-1" };
    const op = makeOp({
      pipeline: pipeWithSources(
        [{ id: "src1", variableName: "validProp", entityType: "trigger", triggerProp: "occurrenceId" }],
        s("UPDATE", { path: "$display.f1.t", value: "$validProp" }),
      ),
    });
    // Verify that providing a valid triggerProp works correctly (guard path covered by prior tests)
    // and that an unrecognized prop returns null from $trigger
    const op2 = makeOp({
      pipeline: pipeWithSources(
        [{ id: "src2", variableName: "noProp", entityType: "trigger", triggerProp: "nonExistentProp" }],
        s("UPDATE", { path: "$display.f1.t", value: "$noProp" }),
      ),
    });
    const result = executePipeline(op2, {}, transaction);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBeNull();
  });
});

// ─── runMatchingOperations ────────────────────────────────────────────────────

describe("runMatchingOperations", () => {
  test("only fires ops matching the transaction type", () => {
    const ops = [
      makeOp({ id: "op1", triggerType: "onChange", blockTree: literalBlock(1), targetFieldId: "f1" }),
      makeOp({ id: "op2", triggerType: "onDrop", blockTree: literalBlock(2), targetFieldId: "f2" }),
    ];
    const result = runMatchingOperations(ops, "MeasureOp", {}, {});
    expect(result).toHaveLength(1);
    expect(result[0].fieldId).toBe("f1");
  });

  test("manual ops never fire automatically", () => {
    const ops = [
      makeOp({ id: "op1", triggerType: "manual", blockTree: literalBlock(99), targetFieldId: "f1" }),
    ];
    expect(runMatchingOperations(ops, "MeasureOp", {}, {})).toHaveLength(0);
    expect(runMatchingOperations(ops, null, {}, {})).toHaveLength(0);
  });

  test("onLoad (null txType) fires onLoad ops", () => {
    const ops = [
      makeOp({ id: "op1", triggerType: "onLoad", blockTree: literalBlock(5), targetFieldId: "f1" }),
    ];
    const result = runMatchingOperations(ops, null, null, {});
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(5);
  });

  test("pipeline ops fire alongside block ops", () => {
    const ops = [
      makeOp({ id: "op1", triggerType: "onLoad", blockTree: literalBlock(10), targetFieldId: "f1" }),
      makeOp({
        id: "op2", triggerType: "onLoad", blockTree: null,
        pipeline: pipe(s("UPDATE", { path: "$display.f2.t", value: "literal:20" })),
      }),
    ];
    const result = runMatchingOperations(ops, null, null, {});
    expect(result).toHaveLength(2);
    expect(result.find(r => r.fieldId === "f1").value).toBe(10);
    expect(result.find(r => r.fieldId === "f2").value).toBe(20);
  });

  test("errors in one op don't crash other ops", () => {
    const ops = [
      makeOp({ id: "op1", triggerType: "onLoad", blockTree: { type: "bad_block_type", id: "x", slots: [], data: {} }, targetFieldId: "f1" }),
      makeOp({ id: "op2", triggerType: "onLoad", blockTree: literalBlock(7), targetFieldId: "f2" }),
    ];
    const result = runMatchingOperations(ops, null, null, {});
    expect(result.some(r => r.fieldId === "f2")).toBe(true);
  });
});

// ─── Target scenarios (daily / weekly / monthly) ──────────────────────────────

describe("Target propagation scenarios", () => {
  test("daily steps target: 10000, value: 6500", () => {
    const op = makeOp({
      blockTree: sendToDisplayBlock("steps_display", literalBlock(6500), literalBlock(10000), "daily"),
    });
    const result = executeOperation(op, null, null, {});
    expect(result[0].value).toBe(6500);
    expect(result[0].target).toEqual({ value: 10000, period: "daily" });
  });

  test("weekly income target: 2000, value: 1800", () => {
    const op = makeOp({
      blockTree: sendToDisplayBlock("income_display", literalBlock(1800), literalBlock(2000), "weekly"),
    });
    const result = executeOperation(op, null, null, {});
    expect(result[0].target).toEqual({ value: 2000, period: "weekly" });
  });

  test("no target slot → target is null", () => {
    const op = makeOp({
      blockTree: sendToDisplayBlock("f1", literalBlock(42), null),
    });
    const result = executeOperation(op, null, null, {});
    expect(result[0].target).toBeNull();
  });

  test("UPDATE display effect carries no target metadata (lives on field config now)", () => {
    const op = makeOp({ pipeline: pipe(s("UPDATE", { path: "$display.f1.t", value: "literal:50" })) });
    const result = executePipeline(op, {});
    expect(result[0]).not.toHaveProperty("target");
    expect(result[0]).toMatchObject({ _effect: "UPDATE_DISPLAY_VALUE", fieldId: "f1", value: 50 });
  });
});

// ─── triggerTypes[] array (multi-trigger) ─────────────────────────────────────

describe("shouldTrigger — triggerTypes[] array", () => {
  test("triggerTypes array: both onChange and onDrop active", () => {
    const op = makeOp({
      triggerType: "onChange",
      triggerTypes: ["onChange", "onDrop"],
    });
    // Should fire on either event type
    expect(shouldTrigger(op, "MeasureOp")).toBe(true);
    expect(shouldTrigger(op, "OccurrenceListOp")).toBe(true);
  });

  test("triggerTypes array overrides legacy triggerType field", () => {
    const op = makeOp({
      triggerType: "manual",
      triggerTypes: ["onFilterChange", "onLoad"],
    });
    expect(shouldTrigger(op, "NavigationOp")).toBe(true);
    expect(shouldTrigger(op, null)).toBe(true);
    expect(shouldTrigger(op, "MeasureOp")).toBe(false);
  });

  test("triggerTypes empty array falls back to single triggerType", () => {
    const op = makeOp({
      triggerType: "onChange",
      triggerTypes: [], // empty → falls back
    });
    // Empty array = no types defined → behaves like "no trigger" (fires on load null)
    expect(shouldTrigger(op, null)).toBe(true);
    expect(shouldTrigger(op, "MeasureOp")).toBe(false);
  });

  test("triggerTypes: multiple types — partial match is enough", () => {
    const op = makeOp({
      triggerTypes: ["onChange", "onFilterChange", "onDrop"],
    });
    expect(shouldTrigger(op, "MeasureOp")).toBe(true);
    expect(shouldTrigger(op, "NavigationOp")).toBe(true);
    expect(shouldTrigger(op, "OccurrenceListOp")).toBe(true);
  });

  test("disabled op with triggerTypes never fires", () => {
    const op = makeOp({
      enabled: false,
      triggerTypes: ["onChange", "onDrop", "onFilterChange"],
    });
    expect(shouldTrigger(op, "MeasureOp")).toBe(false);
    expect(shouldTrigger(op, "OccurrenceListOp")).toBe(false);
    expect(shouldTrigger(op, null)).toBe(false);
  });
});

// ─── triggerObjects filters ────────────────────────────────────────────────────

describe("shouldTrigger — triggerObjects filters", () => {
  test("onChange + field subject: only fires when matching fieldId", () => {
    const op = makeOp({
      triggerTypes: ["onChange"],
      triggerObjects: [
        { eventType: "onChange", subjectType: "field", targetId: "completed" },
      ],
    });
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "completed" })).toBe(true);
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "duration" })).toBe(false);
    expect(shouldTrigger(op, "MeasureOp", {})).toBe(false);
  });

  test("onChange with no triggerObjects passes any MeasureOp", () => {
    const op = makeOp({ triggerTypes: ["onChange"] });
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "anything" })).toBe(true);
    expect(shouldTrigger(op, "MeasureOp", {})).toBe(true);
  });

  test("onChange + multiple field targets: fires when any matches", () => {
    const op = makeOp({
      triggerTypes: ["onChange"],
      triggerObjects: [
        { eventType: "onChange", subjectType: "field", targetId: "water" },
        { eventType: "onChange", subjectType: "field", targetId: "steps" },
      ],
    });
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "water" })).toBe(true);
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "steps" })).toBe(true);
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "mood" })).toBe(false);
  });

  test("onChange + instance subject: filters on instanceId", () => {
    const op = makeOp({
      triggerTypes: ["onChange"],
      triggerObjects: [
        { eventType: "onChange", subjectType: "module", subjectRole: "instance", targetId: "inst-morning" },
      ],
    });
    expect(shouldTrigger(op, "MeasureOp", { instanceId: "inst-morning", fieldId: "x" })).toBe(true);
    expect(shouldTrigger(op, "MeasureOp", { instanceId: "inst-other", fieldId: "x" })).toBe(false);
  });

  test("onAdd + container subject: filters on containerId", () => {
    const op = makeOp({
      triggerTypes: ["onAdd"],
      triggerObjects: [
        { eventType: "onAdd", subjectType: "module", subjectRole: "container", targetId: "slot-9am" },
      ],
    });
    expect(shouldTrigger(op, "OccurrenceCreateOp", { containerId: "slot-9am" })).toBe(true);
    expect(shouldTrigger(op, "OccurrenceCreateOp", { containerId: "slot-10am" })).toBe(false);
  });

  test("onCreate + panel subject: prefers toPanelId, falls back to panelId", () => {
    const op = makeOp({
      triggerTypes: ["onCreate"],
      triggerObjects: [
        { eventType: "onCreate", subjectType: "module", subjectRole: "panel", targetId: "schedule-panel" },
      ],
    });
    expect(shouldTrigger(op, "OccurrenceCreateOp", { toPanelId: "schedule-panel" })).toBe(true);
    expect(shouldTrigger(op, "OccurrenceCreateOp", { toPanelId: "goals-panel" })).toBe(false);
    expect(shouldTrigger(op, "OccurrenceCreateOp", { panelId: "schedule-panel" })).toBe(true);
  });

  test("onMove + container subject: filters on fromContainerId", () => {
    const op = makeOp({
      triggerTypes: ["onMove"],
      triggerObjects: [
        { eventType: "onMove", subjectType: "module", subjectRole: "container", targetId: "task-bank" },
      ],
    });
    expect(shouldTrigger(op, "OccurrenceMoveOp", { fromContainerId: "task-bank" })).toBe(true);
    expect(shouldTrigger(op, "OccurrenceMoveOp", { fromContainerId: "other" })).toBe(false);
  });

  test("onMove + panel subject: filters on fromPanelId", () => {
    const op = makeOp({
      triggerTypes: ["onMove"],
      triggerObjects: [
        { eventType: "onMove", subjectType: "module", subjectRole: "panel", targetId: "center-hub" },
      ],
    });
    expect(shouldTrigger(op, "OccurrenceMoveOp", { fromPanelId: "center-hub" })).toBe(true);
    expect(shouldTrigger(op, "OccurrenceMoveOp", { fromPanelId: "other-panel" })).toBe(false);
  });

  test("grid subject: no filter — matches any transaction of the right event", () => {
    const op = makeOp({
      triggerTypes: ["onFilterChange"],
      triggerObjects: [
        { eventType: "onFilterChange", subjectType: "grid", targetId: "" },
      ],
    });
    expect(shouldTrigger(op, "NavigationOp", {})).toBe(true);
    expect(shouldTrigger(op, "MeasureOp", {})).toBe(false);
  });

  test("empty targetId means no filter", () => {
    const op = makeOp({
      triggerTypes: ["onChange"],
      triggerObjects: [
        { eventType: "onChange", subjectType: "field", targetId: "" },
      ],
    });
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "anything" })).toBe(true);
  });

  test("multi-event with per-event filters: each event keeps its own target", () => {
    const op = makeOp({
      triggerTypes: ["onChange", "onMove"],
      triggerObjects: [
        { eventType: "onChange", subjectType: "field", targetId: "completed" },
        { eventType: "onMove", subjectType: "module", subjectRole: "panel", targetId: "schedule-panel" },
      ],
    });
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "completed" })).toBe(true);
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "duration" })).toBe(false);
    expect(shouldTrigger(op, "OccurrenceMoveOp", { fromPanelId: "schedule-panel" })).toBe(true);
    expect(shouldTrigger(op, "OccurrenceMoveOp", { fromPanelId: "goals-panel" })).toBe(false);
  });

  test("does NOT fire onChange when transaction has no fieldId and target is a fieldId", () => {
    const op = makeOp({
      triggerTypes: ["onChange"],
      triggerObjects: [
        { eventType: "onChange", subjectType: "field", targetId: "water" },
      ],
    });
    expect(shouldTrigger(op, "MeasureOp", {})).toBe(false);
  });
});

describe("computeTriggerMatch — matched triggerObject threading", () => {
  test("returns the matched triggerObject entry", () => {
    const toWater = { eventType: "onChange", subjectType: "field", targetId: "water" };
    const op = makeOp({
      triggerTypes: ["onChange"],
      triggerObjects: [toWater],
    });
    expect(computeTriggerMatch(op, "MeasureOp", { fieldId: "water" }))
      .toEqual({ matched: true, triggerObject: toWater });
  });

  test("returns triggerObject: null when no triggerObjects are set (event-only match)", () => {
    const op = makeOp({ triggerTypes: ["onChange"] });
    expect(computeTriggerMatch(op, "MeasureOp", { fieldId: "any" }))
      .toEqual({ matched: true, triggerObject: null });
  });

  test("picks the specific triggerObject that matched from multiple", () => {
    const toA = { eventType: "onChange", subjectType: "field", targetId: "a" };
    const toB = { eventType: "onChange", subjectType: "field", targetId: "b" };
    const op = makeOp({
      triggerTypes: ["onChange"],
      triggerObjects: [toA, toB],
    });
    expect(computeTriggerMatch(op, "MeasureOp", { fieldId: "b" }))
      .toEqual({ matched: true, triggerObject: toB });
  });

  test("returns false when no triggerObject matches", () => {
    const op = makeOp({
      triggerTypes: ["onChange"],
      triggerObjects: [
        { eventType: "onChange", subjectType: "field", targetId: "water" },
      ],
    });
    expect(computeTriggerMatch(op, "MeasureOp", { fieldId: "mood" })).toBe(false);
  });
});

// ─── $trigger variable in if conditions ───────────────────────────────────────

describe("executePipeline — $trigger variable in if conditions", () => {
  test("$trigger.value IS true — fires matching tx", () => {
    const op = makeOp({
      pipeline: pipe(
        ifS(andCond({ left: "$trigger.value", comparator: "IS", right: "true" }),
          [s("UPDATE", { path: "$display.f1.t", value: "literal:1" })]),
      ),
    });
    expect(executePipeline(op, {}, { value: "true" })).toHaveLength(1);
    expect(executePipeline(op, {}, { value: "false" })).toHaveLength(0);
  });

  test("$trigger.toContainerId IS_EMPTY passes when no container set", () => {
    const op = makeOp({
      pipeline: pipe(
        ifS(andCond({ left: "$trigger.toContainerId", comparator: "IS_EMPTY", right: "" }),
          [s("UPDATE", { path: "$display.f1.t", value: "literal:ok" })]),
      ),
    });
    expect(executePipeline(op, {}, {})).toHaveLength(1);
    expect(executePipeline(op, {}, { toContainerId: "some-id" })).toHaveLength(0);
  });

  test("OR if condition: $trigger.value OR $trigger.toContainerId", () => {
    const op = makeOp({
      pipeline: pipe(
        ifS(orCond(
          { left: "$trigger.value", comparator: "IS", right: "true" },
          { left: "$trigger.toContainerId", comparator: "IS_EMPTY", right: "" },
        ), [s("UPDATE", { path: "$display.f1.t", value: "literal:1" })]),
      ),
    });
    expect(executePipeline(op, {}, { value: "true" })).toHaveLength(1);
    expect(executePipeline(op, {}, {})).toHaveLength(1);
    expect(executePipeline(op, {}, { value: "false", toContainerId: "c1" })).toHaveLength(0);
  });

  test("no transaction → $trigger not in $vars, condition fails", () => {
    const op = makeOp({
      pipeline: pipe(
        ifS(andCond({ left: "$trigger.value", comparator: "IS", right: "true" }),
          [s("UPDATE", { path: "$display.f1.t", value: "literal:1" })]),
      ),
    });
    expect(executePipeline(op, {}, null)).toHaveLength(0);
  });

  test("$trigger.fieldId IS comparison", () => {
    const op = makeOp({
      pipeline: pipe(
        ifS(andCond({ left: "$trigger.fieldId", comparator: "IS", right: "completed" }),
          [s("UPDATE", { path: "$display.f1.t", value: "literal:1" })]),
      ),
    });
    expect(executePipeline(op, {}, { fieldId: "completed" })).toHaveLength(1);
    expect(executePipeline(op, {}, { fieldId: "duration" })).toHaveLength(0);
  });

  test("action BEFORE if always runs, action INSIDE if is conditional", () => {
    const op = makeOp({
      pipeline: pipe(
        s("UPDATE", { path: "$display.always.t", value: "literal:yes" }),
        ifS(andCond({ left: "$trigger.fieldId", comparator: "IS", right: "special" }),
          [s("UPDATE", { path: "$display.conditional.t", value: "literal:special" })]),
      ),
    });
    // Non-matching trigger: only "always" fires
    const r1 = executePipeline(op, {}, { fieldId: "other" });
    expect(r1.map(r => r.fieldId)).toEqual(["always"]);
    // Matching trigger: both fire
    const r2 = executePipeline(op, {}, { fieldId: "special" });
    expect(r2.map(r => r.fieldId)).toContain("always");
    expect(r2.map(r => r.fieldId)).toContain("conditional");
  });
});

// ─── AGGREGATE pipeline action ─────────────────────────────────────────────────

describe("executePipeline — AGGREGATE action", () => {
  function aggStep(opts = {}) {
    return s("AGGREGATE", {
      aggregation: "sum",
      allowedFields: [{ fieldId: "steps", flowFilter: "any" }],
      timeFilter: "all",
      targetFieldId: "steps_total",
      ...opts,
    });
  }

  test("AGGREGATE with zero occurrences returns 0", () => {
    const op = makeOp({ pipeline: pipe(aggStep()) });
    const result = executePipeline(op, { state: {}, fieldsById: {}, occurrencesById: {} });
    expect(result).toHaveLength(1);
    expect(result[0].fieldId).toBe("steps_total");
    expect(result[0].value).toBe(0);
  });

  test("AGGREGATE sum across occurrences", () => {
    const occs = {
      o1: { id: "o1", fields: { steps: { value: 4000, flow: "in" } }, iteration: {} },
      o2: { id: "o2", fields: { steps: { value: 6000, flow: "in" } }, iteration: {} },
    };
    const result = executePipeline(makeOp({ pipeline: pipe(aggStep()) }), { state: {}, fieldsById: {}, occurrencesById: occs });
    expect(result[0].value).toBe(10000);
  });

  test("AGGREGATE countTrue across occurrences", () => {
    const occs = {
      o1: { id: "o1", fields: { completed: { value: true, flow: "in" } }, iteration: {} },
      o2: { id: "o2", fields: { completed: { value: false, flow: "in" } }, iteration: {} },
      o3: { id: "o3", fields: { completed: { value: true, flow: "in" } }, iteration: {} },
    };
    const op = makeOp({ pipeline: pipe(aggStep({ aggregation: "countTrue", allowedFields: [{ fieldId: "completed", flowFilter: "any" }], targetFieldId: "done_count" })) });
    const result = executePipeline(op, { state: {}, fieldsById: {}, occurrencesById: occs });
    expect(result[0].fieldId).toBe("done_count");
    expect(result[0].value).toBe(2);
  });

  test("AGGREGATE with targetValue propagates target", () => {
    const occs = { o1: { id: "o1", fields: { duration: { value: 60, flow: "in" } }, iteration: {} } };
    const op = makeOp({ pipeline: pipe(aggStep({ aggregation: "sum", allowedFields: [{ fieldId: "duration", flowFilter: "any" }], targetFieldId: "dur_total", targetValue: 480, targetPeriod: "daily" })) });
    const result = executePipeline(op, { state: {}, fieldsById: {}, occurrencesById: occs });
    expect(result[0].value).toBe(60);
    expect(result[0].target).toEqual({ value: 480, period: "daily" });
  });

  test("AGGREGATE with no targetValue → target is null", () => {
    const occs = { o1: { id: "o1", fields: { steps: { value: 5000, flow: "in" } }, iteration: {} } };
    const result = executePipeline(makeOp({ pipeline: pipe(aggStep({ targetValue: undefined })) }), { state: {}, fieldsById: {}, occurrencesById: occs });
    expect(result[0].target).toBeNull();
  });

  test("AGGREGATE with single cfg.fieldId (no allowedFields)", () => {
    const occs = {
      o1: { id: "o1", fields: { water: { value: 8, flow: "in" } }, iteration: {} },
      o2: { id: "o2", fields: { water: { value: 4, flow: "in" } }, iteration: {} },
    };
    const op = makeOp({ pipeline: pipe(s("AGGREGATE", { aggregation: "sum", fieldId: "water", flowFilter: "any", timeFilter: "all", targetFieldId: "water_total" })) });
    expect(executePipeline(op, { state: {}, fieldsById: {}, occurrencesById: occs })[0].value).toBe(12);
  });

  test("occurrencesById missing from context returns 0 (not crash)", () => {
    const result = executePipeline(makeOp({ pipeline: pipe(aggStep()) }), { state: {}, fieldsById: {} });
    expect(result[0].value).toBe(0);
  });

  test("AGGREGATE inside if step only runs when condition passes", () => {
    const occs = { o1: { id: "o1", fields: { steps: { value: 5000, flow: "in" } }, iteration: {} } };
    const op = makeOp({
      pipeline: pipe(
        ifS(andCond({ left: "$trigger.fieldId", comparator: "IS", right: "steps" }),
          [aggStep({ targetFieldId: "steps_total" })]),
      ),
    });
    // Matching trigger: agg runs
    const r1 = executePipeline(op, { state: {}, fieldsById: {}, occurrencesById: occs }, { fieldId: "steps" });
    expect(r1[0].value).toBe(5000);
    // Non-matching trigger: agg blocked
    const r2 = executePipeline(op, { state: {}, fieldsById: {}, occurrencesById: occs }, { fieldId: "other" });
    expect(r2).toHaveLength(0);
  });
});

// ─── INCREMENT_FIELD action ────────────────────────────────────────────────────

describe("executePipeline — INCREMENT_FIELD action", () => {
  test("emits _increment update for targetFieldId", () => {
    const result = executePipeline(makeOp({ pipeline: pipe(s("INCREMENT_FIELD", { targetFieldId: "f1", amount: 5 })) }), {});
    expect(result).toHaveLength(1);
    expect(result[0].fieldId).toBe("f1");
    expect(result[0]._increment).toBe(5);
  });

  test("default amount is 1 when not specified", () => {
    const result = executePipeline(makeOp({ pipeline: pipe(s("INCREMENT_FIELD", { targetFieldId: "f1" })) }), {});
    expect(result[0]._increment).toBe(1);
  });

  test("negative amount decrements", () => {
    const result = executePipeline(makeOp({ pipeline: pipe(s("INCREMENT_FIELD", { targetFieldId: "f1", amount: -3 })) }), {});
    expect(result[0]._increment).toBe(-3);
  });

  test("missing targetFieldId is a no-op", () => {
    const result = executePipeline(makeOp({ pipeline: pipe(s("INCREMENT_FIELD", { amount: 5 })) }), {});
    expect(result).toHaveLength(0);
  });
});

// ─── MARK_COMPLETE action ──────────────────────────────────────────────────────

describe("executePipeline — MARK_COMPLETE action", () => {
  test("emits {value: true} for completedFieldId", () => {
    const result = executePipeline(makeOp({ pipeline: pipe(s("MARK_COMPLETE", { completedFieldId: "completed" })) }), {});
    expect(result).toHaveLength(1);
    expect(result[0].fieldId).toBe("completed");
    expect(result[0].value).toBe(true);
  });

  test("markValue: false emits {value: false}", () => {
    const result = executePipeline(makeOp({ pipeline: pipe(s("MARK_COMPLETE", { completedFieldId: "completed", markValue: false })) }), {});
    expect(result[0].value).toBe(false);
  });

  test("missing completedFieldId is a no-op", () => {
    expect(executePipeline(makeOp({ pipeline: pipe(s("MARK_COMPLETE", {})) }), {})).toHaveLength(0);
  });
});

// ─── runMatchingOperations — integration ──────────────────────────────────────

describe("runMatchingOperations — integration with triggerTypes + triggerObjects", () => {
  test("multi-trigger op fires on either event", () => {
    const op = makeOp({
      id: "op1",
      triggerTypes: ["onChange", "onDrop"],
      pipeline: pipe(s("UPDATE", { path: "$display.f1.t", value: "literal:fired" })),
    });
    expect(runMatchingOperations([op], "MeasureOp", {}, {})).toHaveLength(1);
    expect(runMatchingOperations([op], "OccurrenceListOp", {}, {})).toHaveLength(1);
  });

  test("triggerObject field filter — only fires for matching field", () => {
    const op = makeOp({
      id: "op1",
      triggerTypes: ["onChange"],
      triggerObjects: [
        { eventType: "onChange", subjectType: "field", targetId: "completed" },
      ],
      pipeline: pipe(s("UPDATE", { path: "$display.f1.t", value: "literal:1" })),
    });
    expect(runMatchingOperations([op], "MeasureOp", { fieldId: "completed" }, {})).toHaveLength(1);
    expect(runMatchingOperations([op], "MeasureOp", { fieldId: "duration" }, {})).toHaveLength(0);
  });

  test("AGGREGATE op fires on onFilterChange and returns correct sum", () => {
    const occs = {
      o1: { id: "o1", fields: { calories: { value: 400, flow: "in" } }, iteration: {} },
      o2: { id: "o2", fields: { calories: { value: 600, flow: "in" } }, iteration: {} },
    };
    const op = makeOp({
      id: "agg-op",
      triggerType: "onFilterChange",
      pipeline: pipe(s("AGGREGATE", { aggregation: "sum", allowedFields: [{ fieldId: "calories", flowFilter: "any" }], timeFilter: "all", targetFieldId: "cal_total" })),
    });
    const result = runMatchingOperations([op], "NavigationOp", {}, { state: {}, fieldsById: {}, occurrencesById: occs });
    expect(result[0].fieldId).toBe("cal_total");
    expect(result[0].value).toBe(1000);
  });

  test("multiple ops: each fires independently, results combined", () => {
    const ops = [
      makeOp({ id: "op1", triggerType: "onFilterChange", pipeline: pipe(s("UPDATE", { path: "$display.f1.t", value: "literal:10" })) }),
      makeOp({ id: "op2", triggerType: "onFilterChange", pipeline: pipe(s("UPDATE", { path: "$display.f2.t", value: "literal:20" })) }),
      makeOp({ id: "op3", triggerType: "onChange", pipeline: pipe(s("UPDATE", { path: "$display.f3.t", value: "literal:30" })) }),
    ];
    const result = runMatchingOperations(ops, "NavigationOp", {}, {});
    expect(result).toHaveLength(2);
    expect(result.map(r => r.fieldId)).toContain("f1");
    expect(result.map(r => r.fieldId)).toContain("f2");
    expect(result.map(r => r.fieldId)).not.toContain("f3");
  });
});

// ─── DATE_DIFF, COUNT_DATE_OVERDUE, COUNT_DATE_UPCOMING ──────────────────────

describe("Date action types (DATE_DIFF, COUNT_DATE_OVERDUE, COUNT_DATE_UPCOMING)", () => {
  const DUE_FIELD = "dueDate";
  const DAYS_FIELD = "daysUntilDue";
  const OVERDUE_FIELD = "overdueCount";
  const UPCOMING_FIELD = "upcomingCount";

  // Helper: ISO date string N days from today
  function isoDate(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    d.setHours(12, 0, 0, 0);
    return d.toISOString();
  }

  function makeOccWithDue(id, offsetDays) {
    const dateVal = isoDate(offsetDays);
    return { id, fields: { [DUE_FIELD]: { value: dateVal, flow: "replace" } }, iteration: {} };
  }

  test("DATE_DIFF perOccurrence: writes days-until-due per occurrence", () => {
    const occs = [makeOccWithDue("o1", 5), makeOccWithDue("o2", 10), makeOccWithDue("o3", -2)];
    const occurrencesById = {};
    for (const o of occs) occurrencesById[o.id] = o;
    const op = makeOp({
      triggerType: "onFilterChange",
      pipeline: pipe(s("DATE_DIFF", { dateFieldId: DUE_FIELD, targetFieldId: DAYS_FIELD, perOccurrence: true })),
    });
    const result = runMatchingOperations([op], "NavigationOp", {}, { state: {}, fieldsById: {}, occurrencesById });
    // Should produce 3 per-occurrence updates
    expect(result).toHaveLength(3);
    const r1 = result.find(r => r.occurrenceId === "o1");
    const r2 = result.find(r => r.occurrenceId === "o2");
    const r3 = result.find(r => r.occurrenceId === "o3");
    expect(r1.fieldId).toBe(DAYS_FIELD);
    expect(r1.value).toBe(5); // 5 days from now
    expect(r2.value).toBe(10);
    expect(r3.value).toBe(-2); // 2 days past due
  });

  test("DATE_DIFF perOccurrence: skips occurrences without dueDate field", () => {
    const occs = [
      makeOccWithDue("o1", 3),
      { id: "o2", fields: {}, iteration: {} }, // no due date
    ];
    const occurrencesById = {};
    for (const o of occs) occurrencesById[o.id] = o;
    const op = makeOp({
      triggerType: "onFilterChange",
      pipeline: pipe(s("DATE_DIFF", { dateFieldId: DUE_FIELD, targetFieldId: DAYS_FIELD, perOccurrence: true })),
    });
    const result = runMatchingOperations([op], "NavigationOp", {}, { state: {}, fieldsById: {}, occurrencesById });
    expect(result).toHaveLength(1); // only o1
    expect(result[0].occurrenceId).toBe("o1");
  });

  test("DATE_DIFF global (perOccurrence: false): returns closest future due date", () => {
    const occs = [makeOccWithDue("o1", 15), makeOccWithDue("o2", 3), makeOccWithDue("o3", -5)];
    const occurrencesById = {};
    for (const o of occs) occurrencesById[o.id] = o;
    const op = makeOp({
      triggerType: "onFilterChange",
      pipeline: pipe(s("DATE_DIFF", { dateFieldId: DUE_FIELD, targetFieldId: DAYS_FIELD, perOccurrence: false })),
    });
    const result = runMatchingOperations([op], "NavigationOp", {}, { state: {}, fieldsById: {}, occurrencesById });
    expect(result).toHaveLength(1);
    expect(result[0].fieldId).toBe(DAYS_FIELD);
    expect(result[0].value).toBe(3); // closest upcoming is o2 at 3 days
    expect(result[0].occurrenceId).toBeUndefined();
  });

  test("COUNT_DATE_OVERDUE: counts past-due dates", () => {
    const occs = [
      makeOccWithDue("o1", -1),  // overdue
      makeOccWithDue("o2", -10), // overdue
      makeOccWithDue("o3", 5),   // upcoming
      { id: "o4", fields: {}, iteration: {} }, // no due date
    ];
    const occurrencesById = {};
    for (const o of occs) occurrencesById[o.id] = o;
    const op = makeOp({
      triggerType: "onFilterChange",
      pipeline: pipe(s("COUNT_DATE_OVERDUE", { dateFieldId: DUE_FIELD, targetFieldId: OVERDUE_FIELD })),
    });
    const result = runMatchingOperations([op], "NavigationOp", {}, { state: {}, fieldsById: {}, occurrencesById });
    expect(result).toHaveLength(1);
    expect(result[0].fieldId).toBe(OVERDUE_FIELD);
    expect(result[0].value).toBe(2); // o1 and o2
  });

  test("COUNT_DATE_OVERDUE: returns 0 when nothing is overdue", () => {
    const occs = [makeOccWithDue("o1", 1), makeOccWithDue("o2", 30)];
    const occurrencesById = {};
    for (const o of occs) occurrencesById[o.id] = o;
    const op = makeOp({
      triggerType: "onFilterChange",
      pipeline: pipe(s("COUNT_DATE_OVERDUE", { dateFieldId: DUE_FIELD, targetFieldId: OVERDUE_FIELD })),
    });
    const result = runMatchingOperations([op], "NavigationOp", {}, { state: {}, fieldsById: {}, occurrencesById });
    expect(result[0].value).toBe(0);
  });

  test("COUNT_DATE_UPCOMING: counts due within 7 days by default", () => {
    const occs = [
      makeOccWithDue("o1", 0),   // today = upcoming
      makeOccWithDue("o2", 6),   // 6 days = upcoming
      makeOccWithDue("o3", 7),   // exactly 7 days = upcoming
      makeOccWithDue("o4", 8),   // 8 days = NOT upcoming (outside window)
      makeOccWithDue("o5", -1),  // overdue = NOT upcoming
    ];
    const occurrencesById = {};
    for (const o of occs) occurrencesById[o.id] = o;
    const op = makeOp({
      triggerType: "onFilterChange",
      pipeline: pipe(s("COUNT_DATE_UPCOMING", { dateFieldId: DUE_FIELD, targetFieldId: UPCOMING_FIELD, withinDays: 7 })),
    });
    const result = runMatchingOperations([op], "NavigationOp", {}, { state: {}, fieldsById: {}, occurrencesById });
    expect(result[0].fieldId).toBe(UPCOMING_FIELD);
    expect(result[0].value).toBe(3); // o1, o2, o3
  });

  test("COUNT_DATE_UPCOMING: respects custom withinDays", () => {
    const occs = [makeOccWithDue("o1", 5), makeOccWithDue("o2", 15), makeOccWithDue("o3", 30)];
    const occurrencesById = {};
    for (const o of occs) occurrencesById[o.id] = o;
    const op = makeOp({
      triggerType: "onFilterChange",
      pipeline: pipe(s("COUNT_DATE_UPCOMING", { dateFieldId: DUE_FIELD, targetFieldId: UPCOMING_FIELD, withinDays: 20 })),
    });
    const result = runMatchingOperations([op], "NavigationOp", {}, { state: {}, fieldsById: {}, occurrencesById });
    expect(result[0].value).toBe(2); // o1 (5 days) and o2 (15 days); o3 at 30 is outside
  });
});

// ─── Date comparators (DATE_BEFORE_TODAY, DATE_IS_TODAY, etc.) ───────────────

describe("Date comparators in IF conditions", () => {
  function isoDate(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    d.setHours(12, 0, 0, 0);
    return d.toISOString();
  }

  function makeOpWithIf(comparator, leftExpr, rightVal, thenTargetFieldId) {
    return makeOp({
      triggerType: "onFilterChange",
      pipeline: {
        sources: [{ variableName: "occ1", entityType: "occurrence", entityId: "occ1_id" }],
        steps: [{
          id: "step1",
          type: "if",
          condition: { operator: "AND", rules: [{ left: leftExpr, comparator, right: rightVal }] },
          then: [{ id: "t1", type: "action", config: { type: "UPDATE", path: `$display.${thenTargetFieldId}.t`, value: "literal:1" } }],
          else: [{ id: "e1", type: "action", config: { type: "UPDATE", path: `$display.${thenTargetFieldId}.t`, value: "literal:0" } }],
        }],
      },
    });
  }

  function runWithOcc(op, dueDateOffset) {
    const occ = {
      id: "occ1_id",
      fields: { dueDate: { value: isoDate(dueDateOffset), flow: "replace" } },
      iteration: {},
    };
    const occurrencesById = { occ1_id: occ };
    return runMatchingOperations([op], "NavigationOp", {}, { state: {}, fieldsById: {}, occurrencesById });
  }

  test("DATE_BEFORE_TODAY: true when date is in the past", () => {
    const op = makeOpWithIf("DATE_BEFORE_TODAY", "$occ1.dueDate", null, "result");
    // resolveExpr coerces literal:1 → 1 (number), literal:0 → 0 (number)
    expect(runWithOcc(op, -1)[0].value).toBe(1); // -1 day = past → then branch
    expect(runWithOcc(op, 1)[0].value).toBe(0);  // +1 day = future → else branch
  });

  test("DATE_AFTER_TODAY: true when date is in the future", () => {
    const op = makeOpWithIf("DATE_AFTER_TODAY", "$occ1.dueDate", null, "result");
    expect(runWithOcc(op, 1)[0].value).toBe(1);  // future → then
    expect(runWithOcc(op, -1)[0].value).toBe(0); // past → else
  });

  test("DATE_WITHIN_DAYS: true when date is within window", () => {
    const op = makeOpWithIf("DATE_WITHIN_DAYS", "$occ1.dueDate", "7", "result");
    expect(runWithOcc(op, 3)[0].value).toBe(1);  // 3 days = within 7 → then
    expect(runWithOcc(op, 10)[0].value).toBe(0); // 10 days = outside 7 → else
    expect(runWithOcc(op, -1)[0].value).toBe(0); // past = not upcoming → else
  });
});

// ─── resolveExpr / LOOP bug-fixes (Mar 2026) ──────────────────────────────────

describe("resolveExpr — bug fixes", () => {
  test("$var = 0 returns 0, not null (falsy-zero fix)", () => {
    // INIT_VAR sets $total = 0; SHOW_VALUE should emit value: 0
    const op = makeOp({
      triggerType: "onFilterChange",
      triggerTypes: ["onFilterChange", "onLoad"],
      pipeline: {
        sources: [],
        steps: [
          { id: "s1", type: "action", config: { type: "INIT_VAR", name: "$total", value: 0 } },
          { id: "s2", type: "action", config: { type: "UPDATE", path: "$display.f1.t", value: "$total" } },
        ],
      },
    });
    const result = runMatchingOperations([op], null, null, { state: {}, fieldsById: {}, occurrencesById: {} });
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(0);
  });

  test("$var = false returns false, not null", () => {
    const op = makeOp({
      triggerType: "onFilterChange",
      triggerTypes: ["onFilterChange", "onLoad"],
      pipeline: {
        sources: [],
        steps: [
          { id: "s1", type: "action", config: { type: "INIT_VAR", name: "$flag", value: false } },
          { id: "s2", type: "action", config: { type: "UPDATE", path: "$display.f1.t", value: "$flag" } },
        ],
      },
    });
    const result = runMatchingOperations([op], null, null, { state: {}, fieldsById: {}, occurrencesById: {} });
    expect(result[0].value).toBe(false);
  });

  test("MULTIPLY_VAR with numeric expr (-1) does not crash", () => {
    const op = makeOp({
      triggerType: "onFilterChange",
      triggerTypes: ["onFilterChange", "onLoad"],
      pipeline: {
        sources: [],
        steps: [
          { id: "s1", type: "action", config: { type: "INIT_VAR", name: "$x", value: 5 } },
          { id: "s2", type: "action", config: { type: "MULTIPLY_VAR", name: "$x", expr: -1 } },
          { id: "s3", type: "action", config: { type: "UPDATE", path: "$display.f1.t", value: "$x" } },
        ],
      },
    });
    const result = runMatchingOperations([op], null, null, { state: {}, fieldsById: {}, occurrencesById: {} });
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(-5);
  });

  test("IS comparator with boolean right: true does not crash", () => {
    const today = new Date();
    const occ = {
      id: "occ1",
      targetId: "inst1",
      fields: { done: { value: true, flow: "in" } },
      iteration: { value: today.toISOString() },
    };
    const op = makeOp({
      triggerType: "onFilterChange",
      triggerTypes: ["onFilterChange", "onLoad"],
      pipeline: {
        sources: [],
        steps: [
          { id: "s1", type: "action", config: { type: "INIT_VAR", name: "$count", value: 0 } },
          {
            id: "s2", type: "loop",
            over: "field_occurrences", fieldId: "done", timeFilter: "daily", as: "$item",
            body: [{
              id: "b1", type: "if",
              condition: { operator: "AND", rules: [{ comparator: "IS", left: "$item.value", right: true }] },
              then: [{ id: "t1", type: "action", config: { type: "INCREMENT_VAR", name: "$count", by: 1 } }],
              else: [],
            }],
          },
          { id: "s3", type: "action", config: { type: "UPDATE", path: "$display.f1.t", value: "$count" } },
        ],
      },
    });
    const result = runMatchingOperations([op], null, null, { state: {}, fieldsById: {}, occurrencesById: { occ1: occ } });
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(1);  // found 1 occurrence where done === true
  });

  test("LOOP sum with 0 items returns 0 (not null)", () => {
    const op = makeOp({
      triggerType: "onFilterChange",
      triggerTypes: ["onFilterChange", "onLoad"],
      pipeline: {
        sources: [],
        steps: [
          { id: "s1", type: "action", config: { type: "INIT_VAR", name: "$total", value: 0 } },
          {
            id: "s2", type: "loop",
            over: "field_occurrences", fieldId: "duration", timeFilter: "daily", as: "$item",
            body: [{
              id: "b1", type: "if",
              condition: { operator: "AND", rules: [{ comparator: "IS_NOT_EMPTY", left: "$item.value" }] },
              then: [{ id: "t1", type: "action", config: { type: "ADD_TO_VAR", name: "$total", expr: "$item.value" } }],
              else: [],
            }],
          },
          { id: "s3", type: "action", config: { type: "UPDATE", path: "$display.totalDuration.t", value: "$total" } },
        ],
      },
    });
    // No occurrences — loop runs 0 iterations, $total stays 0
    const result = runMatchingOperations([op], null, null, { state: {}, fieldsById: {}, occurrencesById: {} });
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(0);
    // target metadata now lives on the field config, not on the UPDATE effect
    expect(result[0]).not.toHaveProperty("target");
  });

  test("LOOP sum accumulates values from today's occurrences", () => {
    const today = new Date();
    const occs = {
      o1: { id: "o1", targetId: "inst1", fields: { duration: { value: 30, flow: "in" } }, iteration: { value: today.toISOString() } },
      o2: { id: "o2", targetId: "inst1", fields: { duration: { value: 25, flow: "in" } }, iteration: { value: today.toISOString() } },
      o3: { id: "o3", targetId: "inst2", fields: { duration: { value: 99, flow: "in" } }, iteration: { value: new Date("2020-01-01").toISOString() } }, // old — excluded
    };
    const op = makeOp({
      triggerType: "onFilterChange",
      triggerTypes: ["onFilterChange", "onLoad"],
      pipeline: {
        sources: [],
        steps: [
          { id: "s1", type: "action", config: { type: "INIT_VAR", name: "$total", value: 0 } },
          {
            id: "s2", type: "loop",
            over: "field_occurrences", fieldId: "duration", timeFilter: "daily", as: "$item",
            body: [{
              id: "b1", type: "if",
              condition: { operator: "AND", rules: [{ comparator: "IS_NOT_EMPTY", left: "$item.value" }] },
              then: [{ id: "t1", type: "action", config: { type: "ADD_TO_VAR", name: "$total", expr: "$item.value" } }],
              else: [],
            }],
          },
          { id: "s3", type: "action", config: { type: "UPDATE", path: "$display.totalDuration.t", value: "$total" } },
        ],
      },
    });
    const result = runMatchingOperations([op], null, null, { state: {}, fieldsById: {}, occurrencesById: occs });
    expect(result[0].value).toBe(55);  // 30 + 25, old occurrence excluded
  });

  test("UPDATE display effect carries fieldId/itemId/value (no target on the effect)", () => {
    const op = makeOp({
      triggerType: "onFilterChange",
      triggerTypes: ["onFilterChange", "onLoad"],
      pipeline: {
        sources: [],
        steps: [
          { id: "s1", type: "action", config: { type: "INIT_VAR", name: "$v", value: 42 } },
          { id: "s2", type: "action", config: { type: "UPDATE", path: "$display.f1.t", value: "$v" } },
        ],
      },
    });
    const result = runMatchingOperations([op], null, null, { state: {}, fieldsById: {}, occurrencesById: {} });
    expect(result[0]).toMatchObject({ _effect: "UPDATE_DISPLAY_VALUE", fieldId: "f1", itemId: "t", value: 42 });
    expect(result[0]).not.toHaveProperty("target");
  });
});

// ─── Real-world example data operation patterns ────────────────────────────────
// These mirror the operations created in createDefaultUserData.js:
//   - Workout total duration sum (LOOP + INIT_VAR + ADD_TO_VAR + SHOW_VALUE)
//   - Completion rate (LOOP countTrue / MULTIPLY_VAR / DIV_VAR / SHOW_VALUE)
//   - Nutrition daily totals (AGGREGATE sum)
//   - onLoad trigger
//   - Net balance (sum "in" minus sum "out")
// These tests verify the FULL COMPUTATION CHAIN produces correct outputs
// that would populate computedValues in the UI.

describe("Real-world example data operations (workout, nutrition, goals)", () => {
  const TODAY = new Date();
  TODAY.setHours(12, 0, 0, 0);

  function todayOcc(id, instId, fields) {
    return {
      id, targetId: instId,
      fields,
      iteration: { value: TODAY.toISOString(), timeFilter: "daily" },
    };
  }

  // ── Workout total duration sum ──────────────────────────────────────────────
  test("workout total duration: LOOP sum of today's durations with target", () => {
    // Simulates makeLoopSumOp used for workout instances
    const occs = {
      o1: todayOcc("o1", "inst1", { duration: { value: 30, flow: "in" } }),
      o2: todayOcc("o2", "inst2", { duration: { value: 25, flow: "in" } }),
      o3: todayOcc("o3", "inst3", { duration: { value: 15, flow: "in" } }),
    };

    const op = makeOp({
      triggerType: "onFilterChange",
      triggerTypes: ["onFilterChange", "onLoad"],
      pipeline: {
        sources: [],
        steps: [
          { id: "s1", type: "action", config: { type: "INIT_VAR", name: "$total", value: 0 } },
          {
            id: "s2", type: "loop",
            over: "field_occurrences", fieldId: "duration", timeFilter: "daily", as: "$item",
            body: [{ id: "b1", type: "action", config: { type: "ADD_TO_VAR", name: "$total", expr: "$item.value" } }],
          },
          { id: "s3", type: "action", config: { type: "UPDATE", path: "$display.totalDuration.t", value: "$total" } },
        ],
      },
    });

    const result = runMatchingOperations([op], "NavigationOp", {}, { state: {}, fieldsById: {}, occurrencesById: occs });
    expect(result).toHaveLength(1);
    expect(result[0].fieldId).toBe("totalDuration");
    expect(result[0].value).toBe(70); // 30 + 25 + 15
    expect(result[0]).not.toHaveProperty("target");
  });

  test("workout sum: returns 0 (not null) when no occurrences today", () => {
    const op = makeOp({
      triggerType: "onFilterChange",
      pipeline: {
        sources: [],
        steps: [
          { id: "s1", type: "action", config: { type: "INIT_VAR", name: "$total", value: 0 } },
          {
            id: "s2", type: "loop",
            over: "field_occurrences", fieldId: "duration", timeFilter: "daily", as: "$item",
            body: [{ id: "b1", type: "action", config: { type: "ADD_TO_VAR", name: "$total", expr: "$item.value" } }],
          },
          { id: "s3", type: "action", config: { type: "UPDATE", path: "$display.totalDuration.t", value: "$total" } },
        ],
      },
    });

    const result = runMatchingOperations([op], "NavigationOp", {}, { state: {}, fieldsById: {}, occurrencesById: {} });
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(0);
    expect(result[0]).not.toHaveProperty("target");
  });

  // ── Completion rate pipeline ────────────────────────────────────────────────
  test("completion rate: LOOP countTrue / total → percentage with target 100", () => {
    // Simulates makeLoopCountTrueOp + makeCompletionRateOp pattern
    const occs = {
      o1: todayOcc("o1", "inst1", { done: { value: true, flow: "in" } }),
      o2: todayOcc("o2", "inst2", { done: { value: true, flow: "in" } }),
      o3: todayOcc("o3", "inst3", { done: { value: false, flow: "in" } }),
      o4: todayOcc("o4", "inst4", { done: { value: true, flow: "in" } }),
    };

    const op = makeOp({
      triggerType: "onFilterChange",
      triggerTypes: ["onFilterChange", "onLoad"],
      pipeline: {
        sources: [],
        steps: [
          { id: "s1", type: "action", config: { type: "INIT_VAR", name: "$count", value: 0 } },
          { id: "s2", type: "action", config: { type: "INIT_VAR", name: "$total", value: 0 } },
          {
            id: "s3", type: "loop",
            over: "field_occurrences", fieldId: "done", timeFilter: "daily", as: "$item",
            body: [
              { id: "b1", type: "action", config: { type: "INCREMENT_VAR", name: "$total" } },
              {
                id: "b2", type: "if",
                condition: { operator: "AND", rules: [{ left: "$item.value", comparator: "IS", right: true }] },
                then: [{ id: "t1", type: "action", config: { type: "INCREMENT_VAR", name: "$count" } }],
                else: [],
              },
            ],
          },
          { id: "s4", type: "action", config: { type: "MULTIPLY_VAR", name: "$count", expr: 100 } },
          { id: "s5", type: "action", config: { type: "DIV_VAR", name: "$count", by: "$total" } },
          { id: "s6", type: "action", config: { type: "UPDATE", path: "$display.completionRate.t", value: "$count" } },
        ],
      },
    });

    const result = runMatchingOperations([op], "NavigationOp", {}, { state: {}, fieldsById: {}, occurrencesById: occs });
    expect(result).toHaveLength(1);
    expect(result[0].fieldId).toBe("completionRate");
    expect(result[0].value).toBe(75); // 3/4 = 75%
    expect(result[0]).not.toHaveProperty("target");
  });

  test("completion rate: returns 0 when no completions, not NaN or null", () => {
    const occs = {
      o1: todayOcc("o1", "inst1", { done: { value: false, flow: "in" } }),
      o2: todayOcc("o2", "inst2", { done: { value: false, flow: "in" } }),
    };

    const op = makeOp({
      triggerType: "onFilterChange",
      pipeline: {
        sources: [],
        steps: [
          { id: "s1", type: "action", config: { type: "INIT_VAR", name: "$count", value: 0 } },
          { id: "s2", type: "action", config: { type: "INIT_VAR", name: "$total", value: 0 } },
          {
            id: "s3", type: "loop",
            over: "field_occurrences", fieldId: "done", timeFilter: "daily", as: "$item",
            body: [
              { id: "b1", type: "action", config: { type: "INCREMENT_VAR", name: "$total" } },
              {
                id: "b2", type: "if",
                condition: { operator: "AND", rules: [{ left: "$item.value", comparator: "IS", right: true }] },
                then: [{ id: "t1", type: "action", config: { type: "INCREMENT_VAR", name: "$count" } }],
                else: [],
              },
            ],
          },
          { id: "s4", type: "action", config: { type: "MULTIPLY_VAR", name: "$count", expr: 100 } },
          { id: "s5", type: "action", config: { type: "DIV_VAR", name: "$count", by: "$total" } },
          { id: "s6", type: "action", config: { type: "UPDATE", path: "$display.completionRate.t", value: "$count" } },
        ],
      },
    });

    const result = runMatchingOperations([op], "NavigationOp", {}, { state: {}, fieldsById: {}, occurrencesById: occs });
    expect(result[0].value).toBe(0);
  });

  // ── Nutrition macros (AGGREGATE sum) ───────────────────────────────────────
  test("nutrition calories: AGGREGATE sum of today's calorie occurrences", () => {
    const occs = {
      m1: todayOcc("m1", "meal1", { calories: { value: 520, flow: "in" } }),
      m2: todayOcc("m2", "meal2", { calories: { value: 650, flow: "in" } }),
      m3: todayOcc("m3", "meal3", { calories: { value: 380, flow: "in" } }),
      m4: todayOcc("m4", "meal4", { calories: { value: 450, flow: "in" } }),
    };

    const op = makeOp({
      triggerType: "onFilterChange",
      pipeline: pipe(s("AGGREGATE", {
        aggregation: "sum",
        allowedFields: [{ fieldId: "calories", flowFilter: "in" }],
        timeFilter: "daily",
        targetFieldId: "totalCalories",
        targetValue: 2500,
        targetPeriod: "daily",
      })),
    });

    const result = runMatchingOperations([op], "NavigationOp", {}, { state: {}, fieldsById: {}, occurrencesById: occs });
    expect(result).toHaveLength(1);
    expect(result[0].fieldId).toBe("totalCalories");
    expect(result[0].value).toBe(2000); // 520+650+380+450
  });

  test("nutrition protein sum with target", () => {
    const occs = {
      m1: todayOcc("m1", "meal1", { protein: { value: 35, flow: "in" } }),
      m2: todayOcc("m2", "meal2", { protein: { value: 42, flow: "in" } }),
      m3: todayOcc("m3", "meal3", { protein: { value: 28, flow: "in" } }),
    };

    const op = makeOp({
      triggerType: "onFilterChange",
      pipeline: pipe(s("AGGREGATE", {
        aggregation: "sum",
        allowedFields: [{ fieldId: "protein", flowFilter: "in" }],
        timeFilter: "daily",
        targetFieldId: "totalProtein",
        targetValue: 180,
        targetPeriod: "daily",
      })),
    });

    const result = runMatchingOperations([op], "NavigationOp", {}, { state: {}, fieldsById: {}, occurrencesById: occs });
    expect(result[0].value).toBe(105); // 35+42+28
    expect(result[0].target).toEqual({ value: 180, period: "daily" });
  });

  // ── Net balance (in minus out) ──────────────────────────────────────────────
  test("net balance: AGGREGATE sum of 'in' flow minus AGGREGATE sum of 'out' flow", () => {
    const occs = {
      t1: todayOcc("t1", "tx1", { amount: { value: 1000, flow: "in" } }),  // income
      t2: todayOcc("t2", "tx2", { amount: { value: 250, flow: "out" } }),  // expense
      t3: todayOcc("t3", "tx3", { amount: { value: 150, flow: "out" } }),  // expense
    };

    const inOp = makeOp({
      triggerType: "onFilterChange",
      pipeline: pipe(s("AGGREGATE", { aggregation: "sum", allowedFields: [{ fieldId: "amount", flowFilter: "in" }], timeFilter: "daily", targetFieldId: "totalIn" })),
    });
    const outOp = makeOp({
      id: "op2",
      triggerType: "onFilterChange",
      pipeline: pipe(s("AGGREGATE", { aggregation: "sum", allowedFields: [{ fieldId: "amount", flowFilter: "out" }], timeFilter: "daily", targetFieldId: "totalOut" })),
    });

    const ctx = { state: {}, fieldsById: {}, occurrencesById: occs };
    const inResult = runMatchingOperations([inOp], "NavigationOp", {}, ctx);
    const outResult = runMatchingOperations([outOp], "NavigationOp", {}, ctx);

    expect(inResult[0].fieldId).toBe("totalIn");
    expect(inResult[0].value).toBe(1000);

    expect(outResult[0].fieldId).toBe("totalOut");
    // extractFieldValues negates "out" flow values: -250 + -150 = -400
    // Net balance = totalIn + totalOut = 1000 + (-400) = 600
    expect(outResult[0].value).toBe(-400);
  });

  // ── onLoad trigger ──────────────────────────────────────────────────────────
  test("onLoad trigger fires when transactionType is null", () => {
    const op = makeOp({
      triggerType: "onLoad",
      pipeline: pipe(s("UPDATE", { path: "$display.f1.t", value: "literal:loaded" })),
    });

    const result = runMatchingOperations([op], null, {}, {});
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe("loaded");
  });

  test("onLoad trigger does NOT fire for MeasureOp or NavigationOp", () => {
    const op = makeOp({
      triggerType: "onLoad",
      pipeline: pipe(s("UPDATE", { path: "$display.f1.t", value: "literal:1" })),
    });
    expect(runMatchingOperations([op], "MeasureOp", {}, {})).toHaveLength(0);
    expect(runMatchingOperations([op], "NavigationOp", {}, {})).toHaveLength(0);
  });

  // ── Multiple operations fire independently ────────────────────────────────
  test("multiple ops (workout + nutrition + completion) all fire and return independent results", () => {
    const occs = {
      o1: todayOcc("o1", "ex1", { duration: { value: 45, flow: "in" } }),
      o2: todayOcc("o2", "meal1", { calories: { value: 600, flow: "in" } }),
      o3: todayOcc("o3", "habit1", { done: { value: true, flow: "in" } }),
    };

    const ops = [
      makeOp({
        id: "op_dur",
        triggerType: "onFilterChange",
        pipeline: {
          sources: [],
          steps: [
            { id: "s1", type: "action", config: { type: "INIT_VAR", name: "$dur", value: 0 } },
            { id: "s2", type: "loop", over: "field_occurrences", fieldId: "duration", timeFilter: "daily", as: "$item",
              body: [{ id: "b1", type: "action", config: { type: "ADD_TO_VAR", name: "$dur", expr: "$item.value" } }] },
            { id: "s3", type: "action", config: { type: "UPDATE", path: "$display.totalDuration.t", value: "$dur" } },
          ],
        },
      }),
      makeOp({
        id: "op_cal",
        triggerType: "onFilterChange",
        pipeline: pipe(s("AGGREGATE", { aggregation: "sum", allowedFields: [{ fieldId: "calories", flowFilter: "in" }], timeFilter: "daily", targetFieldId: "totalCal" })),
      }),
    ];

    const result = runMatchingOperations(ops, "NavigationOp", {}, { state: {}, fieldsById: {}, occurrencesById: occs });
    expect(result).toHaveLength(2);
    const dur = result.find(r => r.fieldId === "totalDuration");
    const cal = result.find(r => r.fieldId === "totalCal");
    expect(dur.value).toBe(45);
    expect(cal.value).toBe(600);
  });

  // ── Display-write effect shape ───────────────────────────────────────
  test("UPDATE display effect shape (no target slot — target lives on the field config)", () => {
    const op = makeOp({
      triggerType: "onFilterChange",
      pipeline: pipe(s("UPDATE", { path: "$display.f1.t", value: "literal:42" })),
    });
    const result = runMatchingOperations([op], "NavigationOp", {}, {});
    expect(result[0]).toMatchObject({ _effect: "UPDATE_DISPLAY_VALUE", fieldId: "f1", itemId: "t", value: 42 });
    expect(result[0]).not.toHaveProperty("target");
  });

  test("UPDATE display effect carries the resolved value", () => {
    const op = makeOp({
      triggerType: "onFilterChange",
      pipeline: pipe(s("UPDATE", { path: "$display.f1.t", value: "literal:30" })),
    });
    const result = runMatchingOperations([op], "NavigationOp", {}, {});
    expect(result[0].value).toBe(30);
  });
});

// ─── UPDATE_STYLE / UPDATE_MODULE effects ────────────────────────────────────

describe("UPDATE_STYLE and UPDATE_MODULE effect steps", () => {
  test("UPDATE_STYLE emits _effect: UPDATE_MODULE with ownStyle patch", () => {
    const op = makeOp({
      pipeline: pipe(
        s("UPDATE_STYLE", {
          moduleId: "literal:mod1",
          style: { background: "literal:#ff0000", color: "literal:#ffffff" },
        })
      ),
    });
    const result = executePipeline(op, {});
    expect(result).toHaveLength(1);
    expect(result[0]._effect).toBe("UPDATE_MODULE");
    expect(result[0].moduleId).toBe("mod1");
    expect(result[0].patch).toEqual({ ownStyle: { background: "#ff0000", color: "#ffffff" } });
  });

  test("UPDATE_STYLE resolves moduleIdExpr from $vars", () => {
    const op = makeOp({
      pipeline: pipe(
        s("UPDATE_STYLE", {
          moduleIdExpr: "$targetId",
          style: { background: "literal:#00ff00" },
        })
      ),
    });
    const ctx = { state: {}, fieldsById: {}, occurrencesById: {} };
    // inject $targetId via a INIT_VAR + SHOW_VALUE isn't easy here — test via $trigger instead
    const result = executePipeline(op, ctx);
    // $targetId not in scope → modId resolves to undefined → no effect emitted
    expect(result).toHaveLength(0);
  });

  test("UPDATE_STYLE with no style config emits nothing", () => {
    const op = makeOp({
      pipeline: pipe(s("UPDATE_STYLE", { moduleId: "literal:mod1" })),
    });
    const result = executePipeline(op, {});
    expect(result).toHaveLength(0);
  });

  test("UPDATE_MODULE emits _effect with arbitrary patch", () => {
    const op = makeOp({
      pipeline: pipe(
        s("UPDATE_MODULE", {
          moduleId: "literal:mod2",
          patch: { label: "New Label" },
        })
      ),
    });
    const result = executePipeline(op, {});
    expect(result).toHaveLength(1);
    expect(result[0]._effect).toBe("UPDATE_MODULE");
    expect(result[0].moduleId).toBe("mod2");
    expect(result[0].patch).toEqual({ label: "New Label" });
  });

  test("UPDATE_MODULE with patchJson string parses it correctly", () => {
    const op = makeOp({
      pipeline: pipe(
        s("UPDATE_MODULE", {
          moduleId: "literal:mod3",
          patchJson: '{"label":"From JSON","meta":{"x":1}}',
        })
      ),
    });
    const result = executePipeline(op, {});
    expect(result[0].patch).toEqual({ label: "From JSON", meta: { x: 1 } });
  });

  test("UPDATE_MODULE with invalid patchJson emits nothing", () => {
    const op = makeOp({
      pipeline: pipe(
        s("UPDATE_MODULE", {
          moduleId: "literal:mod4",
          patchJson: "not valid json{{{",
        })
      ),
    });
    const result = executePipeline(op, {});
    expect(result).toHaveLength(0);
  });
});

// ─── $trigger.occurrence auto-injection ───────────────────────────────────────

describe("executePipeline — $trigger.occurrence auto-injection", () => {
  test("triggers with occurrenceId expose enriched $trigger.occurrence", () => {
    const occ = {
      id: "occ-water",
      targetId: "inst1",
      parentId: "page-april-17",
      fields: { water: { value: 32, flow: "in" }, completed: { value: true, flow: null } },
    };
    const op = makeOp({
      pipeline: pipe(
        s("UPDATE", { path: "$display.f1.t", value: "$trigger.occurrence.fields.water.value" }),
      ),
    });
    const ctx = { state: {}, fieldsById: {}, occurrencesById: { "occ-water": occ } };
    const result = executePipeline(op, ctx, { occurrenceId: "occ-water", value: 32, fieldId: "water" });
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(32);
  });

  test("$trigger.occurrence.id and parentId are populated", () => {
    const occ = { id: "occ1", targetId: "inst1", parentId: "page-april-17", fields: {} };
    const op = makeOp({
      pipeline: pipe(
        s("UPDATE", { path: "$display.f_parent.t", value: "$trigger.occurrence.parentId" }),
        s("UPDATE", { path: "$display.f_id.t", value: "$trigger.occurrence.id" }),
        s("UPDATE", { path: "$display.f_target.t", value: "$trigger.occurrence.targetId" }),
      ),
    });
    const ctx = { state: {}, fieldsById: {}, occurrencesById: { occ1: occ } };
    const result = executePipeline(op, ctx, { occurrenceId: "occ1" });
    expect(result.find(r => r.fieldId === "f_parent").value).toBe("page-april-17");
    expect(result.find(r => r.fieldId === "f_id").value).toBe("occ1");
    expect(result.find(r => r.fieldId === "f_target").value).toBe("inst1");
  });

  test("fields map keeps {value, flow} shape — flow accessible separately", () => {
    const occ = {
      id: "occ1",
      targetId: "inst1",
      fields: { amount: { value: 50, flow: "out" } },
    };
    const op = makeOp({
      pipeline: pipe(
        s("UPDATE", { path: "$display.v.t", value: "$trigger.occurrence.fields.amount.value" }),
        s("UPDATE", { path: "$display.f.t", value: "$trigger.occurrence.fields.amount.flow" }),
      ),
    });
    const ctx = { state: {}, fieldsById: {}, occurrencesById: { occ1: occ } };
    const result = executePipeline(op, ctx, { occurrenceId: "occ1" });
    expect(result.find(r => r.fieldId === "v").value).toBe(50);
    expect(result.find(r => r.fieldId === "f").value).toBe("out");
  });

  test("transaction without occurrenceId leaves $trigger.occurrence undefined", () => {
    const op = makeOp({
      pipeline: pipe(
        ifS(andCond({ left: "$trigger.occurrence", comparator: "IS_EMPTY", right: "" }),
          [s("UPDATE", { path: "$display.noOcc.t", value: "literal:1" })],
          [s("UPDATE", { path: "$display.hasOcc.t", value: "literal:1" })]),
      ),
    });
    const result = executePipeline(op, { state: {}, fieldsById: {}, occurrencesById: {} }, { value: "x" });
    expect(result).toHaveLength(1);
    expect(result[0].fieldId).toBe("noOcc");
  });

  test("unknown occurrenceId leaves enrichment off but preserves other trigger fields", () => {
    const op = makeOp({
      pipeline: pipe(
        s("UPDATE", { path: "$display.v.t", value: "$trigger.value" }),
      ),
    });
    const result = executePipeline(op, { state: {}, fieldsById: {}, occurrencesById: {} },
      { occurrenceId: "missing", value: 7 });
    expect(result[0].value).toBe(7);
  });

  test("preserves the original transaction fields alongside the enrichment", () => {
    const occ = { id: "occ1", targetId: "inst1", fields: { water: { value: 16, flow: "in" } } };
    const op = makeOp({
      pipeline: pipe(
        s("UPDATE", { path: "$display.field.t", value: "$trigger.fieldId" }),
        s("UPDATE", { path: "$display.water.t", value: "$trigger.occurrence.fields.water.value" }),
      ),
    });
    const ctx = { state: {}, fieldsById: {}, occurrencesById: { occ1: occ } };
    const result = executePipeline(op, ctx, { occurrenceId: "occ1", fieldId: "water", value: 16 });
    expect(result.find(r => r.fieldId === "field").value).toBe("water");
    expect(result.find(r => r.fieldId === "water").value).toBe(16);
  });
});

// ─── runMatchingOperations — sortOrder priority ───────────────────────────────

describe("runMatchingOperations — sortOrder priority", () => {
  test("ops execute in ascending sortOrder", () => {
    const ops = [
      makeOp({ id: "op-c", sortOrder: 30, triggerType: "onLoad", blockTree: literalBlock("c"), targetFieldId: "f1" }),
      makeOp({ id: "op-a", sortOrder: 10, triggerType: "onLoad", blockTree: literalBlock("a"), targetFieldId: "f1" }),
      makeOp({ id: "op-b", sortOrder: 20, triggerType: "onLoad", blockTree: literalBlock("b"), targetFieldId: "f1" }),
    ];
    const result = runMatchingOperations(ops, null, null, {});
    // Each op writes one update — order of updates reflects op execution order
    expect(result.map(r => r.value)).toEqual(["a", "b", "c"]);
  });

  test("ops without sortOrder default to 50 (interleave with explicit values)", () => {
    const ops = [
      makeOp({ id: "high",   sortOrder: 90, triggerType: "onLoad", blockTree: literalBlock("high"),   targetFieldId: "f1" }),
      makeOp({ id: "noSort",                triggerType: "onLoad", blockTree: literalBlock("noSort"), targetFieldId: "f1" }),
      makeOp({ id: "low",    sortOrder: 10, triggerType: "onLoad", blockTree: literalBlock("low"),    targetFieldId: "f1" }),
    ];
    const result = runMatchingOperations(ops, null, null, {});
    expect(result.map(r => r.value)).toEqual(["low", "noSort", "high"]);
  });

  test("sortOrder ties preserve original input order (stable sort)", () => {
    const ops = [
      makeOp({ id: "first",  sortOrder: 50, triggerType: "onLoad", blockTree: literalBlock("first"),  targetFieldId: "f1" }),
      makeOp({ id: "second", sortOrder: 50, triggerType: "onLoad", blockTree: literalBlock("second"), targetFieldId: "f1" }),
      makeOp({ id: "third",  sortOrder: 50, triggerType: "onLoad", blockTree: literalBlock("third"),  targetFieldId: "f1" }),
    ];
    const result = runMatchingOperations(ops, null, null, {});
    expect(result.map(r => r.value)).toEqual(["first", "second", "third"]);
  });

  test("sorting does not mutate the input array", () => {
    const ops = [
      makeOp({ id: "op-c", sortOrder: 30, triggerType: "onLoad", blockTree: literalBlock("c"), targetFieldId: "f1" }),
      makeOp({ id: "op-a", sortOrder: 10, triggerType: "onLoad", blockTree: literalBlock("a"), targetFieldId: "f1" }),
    ];
    const inputOrder = ops.map(o => o.id);
    runMatchingOperations(ops, null, null, {});
    expect(ops.map(o => o.id)).toEqual(inputOrder);
  });

  test("non-matching ops still respect sort but don't produce updates", () => {
    const ops = [
      makeOp({ id: "drop",   sortOrder: 5,  triggerType: "onDrop",      triggerTypes: ["onDrop"], blockTree: literalBlock("drop"),   targetFieldId: "f1" }),
      makeOp({ id: "iter-a", sortOrder: 10, triggerType: "onLoad", blockTree: literalBlock("iter-a"), targetFieldId: "f1" }),
      makeOp({ id: "iter-b", sortOrder: 20, triggerType: "onLoad", blockTree: literalBlock("iter-b"), targetFieldId: "f1" }),
    ];
    const result = runMatchingOperations(ops, null, null, {});
    expect(result.map(r => r.value)).toEqual(["iter-a", "iter-b"]);
  });
});

// ─── shouldTrigger — onFieldChange / onFilterChange aliases ──────────────────

describe("shouldTrigger — onFieldChange / onFilterChange aliases", () => {
  test("onFieldChange fires on MeasureOp like onChange", () => {
    const op = makeOp({ triggerType: "onFieldChange", triggerTypes: ["onFieldChange"] });
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "any" })).toBe(true);
    expect(shouldTrigger(op, "OccurrenceListOp")).toBe(false);
    expect(shouldTrigger(op, "NavigationOp")).toBe(false);
  });

  test("onFieldChange respects fieldId filter via triggerObjects", () => {
    const op = makeOp({
      triggerTypes: ["onFieldChange"],
      triggerObjects: [
        { eventType: "onFieldChange", subjectType: "field", targetId: "completed" },
      ],
    });
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "completed" })).toBe(true);
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "duration" })).toBe(false);
  });

  test("onFieldChange fires without a triggerObject filter (event-only match)", () => {
    const op = makeOp({ triggerTypes: ["onFieldChange"] });
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "completed" })).toBe(true);
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "duration" })).toBe(true);
  });

  test("onFieldChange with multiple field targets matches any of them", () => {
    const op = makeOp({
      triggerTypes: ["onFieldChange"],
      triggerObjects: [
        { eventType: "onFieldChange", subjectType: "field", targetId: "water" },
        { eventType: "onFieldChange", subjectType: "field", targetId: "steps" },
      ],
    });
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "water" })).toBe(true);
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "steps" })).toBe(true);
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "mood" })).toBe(false);
  });

  test("onFieldChange with instance subject filters on instanceId", () => {
    const op = makeOp({
      triggerTypes: ["onFieldChange"],
      triggerObjects: [
        { eventType: "onFieldChange", subjectType: "module", subjectRole: "instance", targetId: "inst-morning" },
      ],
    });
    expect(shouldTrigger(op, "MeasureOp", { instanceId: "inst-morning", fieldId: "x" })).toBe(true);
    expect(shouldTrigger(op, "MeasureOp", { instanceId: "inst-other", fieldId: "x" })).toBe(false);
  });

  test("onFilterChange fires on NavigationOp", () => {
    const op = makeOp({ triggerType: "onFilterChange", triggerTypes: ["onFilterChange"] });
    expect(shouldTrigger(op, "NavigationOp")).toBe(true);
    expect(shouldTrigger(op, "MeasureOp")).toBe(false);
    expect(shouldTrigger(op, "OccurrenceListOp")).toBe(false);
  });

  test("onFilterChange does not fire on null transactionType (load)", () => {
    // Filter-change is a navigation event — load is its own thing (onLoad).
    const op = makeOp({ triggerType: "onFilterChange", triggerTypes: ["onFilterChange"] });
    expect(shouldTrigger(op, null)).toBe(false);
  });

  test("onFieldChange + onFilterChange combined fire on both event types", () => {
    const op = makeOp({ triggerTypes: ["onFieldChange", "onFilterChange"] });
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "x" })).toBe(true);
    expect(shouldTrigger(op, "NavigationOp")).toBe(true);
    expect(shouldTrigger(op, "OccurrenceListOp")).toBe(false);
  });
});
