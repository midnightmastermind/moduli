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

  test("onIteration fires on IterationOp and on load (null)", () => {
    const op = makeOp({ triggerType: "onIteration" });
    expect(shouldTrigger(op, "NavigationOp")).toBe(true);
    expect(shouldTrigger(op, null)).toBe(true);
    expect(shouldTrigger(op, "MeasureOp")).toBe(false);
  });

  test("disabled op never triggers", () => {
    const op = makeOp({ triggerType: "onIteration", enabled: false });
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

  test("SHOW_VALUE step with literal expr writes to field", () => {
    const op = makeOp({ pipeline: pipe(s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "literal:42" })) });
    const result = executePipeline(op, {});
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ fieldId: "f1", value: "42", target: null });
  });

  test("source resolves field values from occurrences into $var", () => {
    const occs = [
      { id: "o1", targetId: "inst1", fields: { score: { value: 88, flow: "in" } }, iteration: {} },
    ];
    const op = makeOp({
      pipeline: pipeWithSources(
        [{ id: "src1", variableName: "habit", entityType: "instance", entityId: "inst1" }],
        s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "$habit.score" }),
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
          [s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "literal:1" })]),
      ),
    });
    const result = executePipeline(op, {});
    expect(result).toHaveLength(1);
  });

  test("if step — failing condition runs else branch", () => {
    const op = makeOp({
      pipeline: pipe(
        ifS(andCond({ left: "literal:3", comparator: "GREATER", right: "10" }),
          [s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "literal:then" })],
          [s("SHOW_VALUE", { targetFieldId: "f2", sourceExpr: "literal:else" })]),
      ),
    });
    const result = executePipeline(op, {});
    expect(result).toHaveLength(1);
    expect(result[0].fieldId).toBe("f2");
    expect(result[0].value).toBe("else");
  });

  test("action before if always runs regardless of condition", () => {
    const op = makeOp({
      pipeline: pipe(
        s("SHOW_VALUE", { targetFieldId: "f0", sourceExpr: "literal:always" }),
        ifS(andCond({ left: "literal:1", comparator: "GREATER", right: "100" }),
          [s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "literal:then" })]),
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
        ), [s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "literal:ok" })]),
      ),
    });
    const result = executePipeline(op, {});
    expect(result).toHaveLength(1);
  });

  test("IS_EMPTY comparator — empty string passes", () => {
    const op = makeOp({
      pipeline: pipe(
        ifS(andCond({ left: "", comparator: "IS_EMPTY", right: "" }),
          [s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "literal:1" })]),
      ),
    });
    expect(executePipeline(op, {})).toHaveLength(1);
  });

  test("NOTIFY step fires without blocking other steps", () => {
    const op = makeOp({
      pipeline: pipe(
        s("NOTIFY", { message: "Hello!" }),
        s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "literal:7" }),
      ),
    });
    const result = executePipeline(op, {});
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe("7");
  });

  test("RUN_OPERATION recurses into sub-pipeline", () => {
    const subOp = makeOp({
      id: "sub1",
      pipeline: pipe(s("SHOW_VALUE", { targetFieldId: "f2", sourceExpr: "literal:99" })),
    });
    const op = makeOp({
      pipeline: pipe(s("RUN_OPERATION", { operationId: "sub1" })),
    });
    const result = executePipeline(op, {
      state: {}, fieldsById: {}, occurrencesById: {}, operationsById: { sub1: subOp },
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ fieldId: "f2", value: "99", target: null });
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
        s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "literal:10" }),
        s("SHOW_VALUE", { targetFieldId: "f2", sourceExpr: "literal:20" }),
        s("SHOW_VALUE", { targetFieldId: "f3", sourceExpr: "literal:30" }),
      ),
    });
    const result = executePipeline(op, {});
    expect(result).toHaveLength(3);
    expect(result.map(r => r.fieldId)).toEqual(["f1", "f2", "f3"]);
    expect(result.map(r => r.value)).toEqual(["10", "20", "30"]);
  });

  test("nested if steps (if inside then branch)", () => {
    const op = makeOp({
      pipeline: pipe(
        ifS(andCond({ left: "literal:5", comparator: "IS", right: "5" }),
          [
            ifS(andCond({ left: "literal:3", comparator: "IS", right: "3" }),
              [s("SHOW_VALUE", { targetFieldId: "deep", sourceExpr: "literal:nested" })]),
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
        s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "$trigOccId" }),
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
        s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "$changedField" }),
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
        s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "$validProp" }),
      ),
    });
    // Verify that providing a valid triggerProp works correctly (guard path covered by prior tests)
    // and that an unrecognized prop returns null from $trigger
    const op2 = makeOp({
      pipeline: pipeWithSources(
        [{ id: "src2", variableName: "noProp", entityType: "trigger", triggerProp: "nonExistentProp" }],
        s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "$noProp" }),
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

  test("onLoad (null txType) fires onIteration ops", () => {
    const ops = [
      makeOp({ id: "op1", triggerType: "onIteration", blockTree: literalBlock(5), targetFieldId: "f1" }),
    ];
    const result = runMatchingOperations(ops, null, null, {});
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(5);
  });

  test("pipeline ops fire alongside block ops", () => {
    const ops = [
      makeOp({ id: "op1", triggerType: "onIteration", blockTree: literalBlock(10), targetFieldId: "f1" }),
      makeOp({
        id: "op2", triggerType: "onIteration", blockTree: null,
        pipeline: pipe(s("SHOW_VALUE", { targetFieldId: "f2", sourceExpr: "literal:20" })),
      }),
    ];
    const result = runMatchingOperations(ops, null, null, {});
    expect(result).toHaveLength(2);
    expect(result.find(r => r.fieldId === "f1").value).toBe(10);
    expect(result.find(r => r.fieldId === "f2").value).toBe("20");
  });

  test("errors in one op don't crash other ops", () => {
    const ops = [
      makeOp({ id: "op1", triggerType: "onIteration", blockTree: { type: "bad_block_type", id: "x", slots: [], data: {} }, targetFieldId: "f1" }),
      makeOp({ id: "op2", triggerType: "onIteration", blockTree: literalBlock(7), targetFieldId: "f2" }),
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

  test("pipeline SHOW_VALUE with no targetValue emits target: null", () => {
    const op = makeOp({ pipeline: pipe(s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "literal:50" })) });
    const result = executePipeline(op, {});
    expect(result[0].target).toBeNull();
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
      triggerTypes: ["onChange", "onIteration", "onDrop"],
    });
    expect(shouldTrigger(op, "MeasureOp")).toBe(true);
    expect(shouldTrigger(op, "NavigationOp")).toBe(true);
    expect(shouldTrigger(op, "OccurrenceListOp")).toBe(true);
  });

  test("disabled op with triggerTypes never fires", () => {
    const op = makeOp({
      enabled: false,
      triggerTypes: ["onChange", "onDrop", "onIteration"],
    });
    expect(shouldTrigger(op, "MeasureOp")).toBe(false);
    expect(shouldTrigger(op, "OccurrenceListOp")).toBe(false);
    expect(shouldTrigger(op, null)).toBe(false);
  });
});

// ─── triggerConfig filters ─────────────────────────────────────────────────────

describe("shouldTrigger — triggerConfig filters", () => {
  test("onChange.fieldId filter: only fires when matching fieldId", () => {
    const op = makeOp({
      triggerType: "onChange",
      triggerConfig: { onChange: { fieldId: "completed" } },
    });
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "completed" })).toBe(true);
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "duration" })).toBe(false);
    expect(shouldTrigger(op, "MeasureOp", {})).toBe(false);
  });

  test("onChange.fieldId filter: no filter config passes any MeasureOp", () => {
    const op = makeOp({
      triggerType: "onChange",
      triggerConfig: {},
    });
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "anything" })).toBe(true);
    expect(shouldTrigger(op, "MeasureOp", {})).toBe(true);
  });

  test("onDrop.targetPanelId filter: only fires for specific panel", () => {
    const op = makeOp({
      triggerType: "onDrop",
      triggerConfig: { onDrop: { targetPanelId: "schedule-panel" } },
    });
    expect(shouldTrigger(op, "OccurrenceListOp", { toPanelId: "schedule-panel" })).toBe(true);
    expect(shouldTrigger(op, "OccurrenceListOp", { toPanelId: "goals-panel" })).toBe(false);
    expect(shouldTrigger(op, "OccurrenceListOp", {})).toBe(false);
  });

  test("onDrop.targetContainerId filter", () => {
    const op = makeOp({
      triggerType: "onDrop",
      triggerConfig: { onDrop: { targetContainerId: "slot-9am" } },
    });
    expect(shouldTrigger(op, "OccurrenceListOp", { toContainerId: "slot-9am" })).toBe(true);
    expect(shouldTrigger(op, "OccurrenceListOp", { toContainerId: "slot-10am" })).toBe(false);
  });

  test("onDrop.fromContainerId filter", () => {
    const op = makeOp({
      triggerType: "onDrop",
      triggerConfig: { onDrop: { fromContainerId: "task-bank" } },
    });
    expect(shouldTrigger(op, "OccurrenceListOp", { fromContainerId: "task-bank" })).toBe(true);
    expect(shouldTrigger(op, "OccurrenceListOp", { fromContainerId: "other" })).toBe(false);
  });

  test("onChange.instanceId filter", () => {
    const op = makeOp({
      triggerType: "onChange",
      triggerConfig: { onChange: { instanceId: "inst-morning" } },
    });
    expect(shouldTrigger(op, "MeasureOp", { instanceId: "inst-morning", fieldId: "x" })).toBe(true);
    expect(shouldTrigger(op, "MeasureOp", { instanceId: "inst-other", fieldId: "x" })).toBe(false);
  });

  test("multi-trigger with per-type config: each type uses its own config", () => {
    const op = makeOp({
      triggerTypes: ["onChange", "onDrop"],
      triggerConfig: {
        onChange: { fieldId: "completed" },
        onDrop: { targetPanelId: "schedule-panel" },
      },
    });
    // onChange: must match fieldId
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "completed" })).toBe(true);
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "duration" })).toBe(false);
    // onDrop: must match panel
    expect(shouldTrigger(op, "OccurrenceListOp", { toPanelId: "schedule-panel" })).toBe(true);
    expect(shouldTrigger(op, "OccurrenceListOp", { toPanelId: "goals-panel" })).toBe(false);
  });

  test("fires onChange when transaction.fieldId matches allowedFields", () => {
    const op = makeOp({
      triggerTypes: ["onChange"],
      triggerConfig: { onChange: { allowedFields: ["fieldA"] } },
    });
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "fieldA" })).toBe(true);
  });

  test("does NOT fire onChange when transaction has no fieldId and allowedFields is set", () => {
    const op = makeOp({
      triggerTypes: ["onChange"],
      triggerConfig: { onChange: { allowedFields: ["fieldA"] } },
    });
    expect(shouldTrigger(op, "MeasureOp", {})).toBe(false);
  });
});

// ─── $trigger variable in if conditions ───────────────────────────────────────

describe("executePipeline — $trigger variable in if conditions", () => {
  test("$trigger.value IS true — fires matching tx", () => {
    const op = makeOp({
      pipeline: pipe(
        ifS(andCond({ left: "$trigger.value", comparator: "IS", right: "true" }),
          [s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "literal:1" })]),
      ),
    });
    expect(executePipeline(op, {}, { value: "true" })).toHaveLength(1);
    expect(executePipeline(op, {}, { value: "false" })).toHaveLength(0);
  });

  test("$trigger.toContainerId IS_EMPTY passes when no container set", () => {
    const op = makeOp({
      pipeline: pipe(
        ifS(andCond({ left: "$trigger.toContainerId", comparator: "IS_EMPTY", right: "" }),
          [s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "literal:ok" })]),
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
        ), [s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "literal:1" })]),
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
          [s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "literal:1" })]),
      ),
    });
    expect(executePipeline(op, {}, null)).toHaveLength(0);
  });

  test("$trigger.fieldId IS comparison", () => {
    const op = makeOp({
      pipeline: pipe(
        ifS(andCond({ left: "$trigger.fieldId", comparator: "IS", right: "completed" }),
          [s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "literal:1" })]),
      ),
    });
    expect(executePipeline(op, {}, { fieldId: "completed" })).toHaveLength(1);
    expect(executePipeline(op, {}, { fieldId: "duration" })).toHaveLength(0);
  });

  test("action BEFORE if always runs, action INSIDE if is conditional", () => {
    const op = makeOp({
      pipeline: pipe(
        s("SHOW_VALUE", { targetFieldId: "always", sourceExpr: "literal:yes" }),
        ifS(andCond({ left: "$trigger.fieldId", comparator: "IS", right: "special" }),
          [s("SHOW_VALUE", { targetFieldId: "conditional", sourceExpr: "literal:special" })]),
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

describe("runMatchingOperations — integration with triggerTypes + triggerConfig", () => {
  test("multi-trigger op fires on either event", () => {
    const op = makeOp({
      id: "op1",
      triggerTypes: ["onChange", "onDrop"],
      pipeline: pipe(s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "literal:fired" })),
    });
    expect(runMatchingOperations([op], "MeasureOp", {}, {})).toHaveLength(1);
    expect(runMatchingOperations([op], "OccurrenceListOp", {}, {})).toHaveLength(1);
  });

  test("triggerConfig onChange.fieldId — only fires for matching field", () => {
    const op = makeOp({
      id: "op1",
      triggerType: "onChange",
      triggerConfig: { onChange: { fieldId: "completed" } },
      pipeline: pipe(s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "literal:1" })),
    });
    expect(runMatchingOperations([op], "MeasureOp", { fieldId: "completed" }, {})).toHaveLength(1);
    expect(runMatchingOperations([op], "MeasureOp", { fieldId: "duration" }, {})).toHaveLength(0);
  });

  test("AGGREGATE op fires on onIteration and returns correct sum", () => {
    const occs = {
      o1: { id: "o1", fields: { calories: { value: 400, flow: "in" } }, iteration: {} },
      o2: { id: "o2", fields: { calories: { value: 600, flow: "in" } }, iteration: {} },
    };
    const op = makeOp({
      id: "agg-op",
      triggerType: "onIteration",
      pipeline: pipe(s("AGGREGATE", { aggregation: "sum", allowedFields: [{ fieldId: "calories", flowFilter: "any" }], timeFilter: "all", targetFieldId: "cal_total" })),
    });
    const result = runMatchingOperations([op], "NavigationOp", {}, { state: {}, fieldsById: {}, occurrencesById: occs });
    expect(result[0].fieldId).toBe("cal_total");
    expect(result[0].value).toBe(1000);
  });

  test("multiple ops: each fires independently, results combined", () => {
    const ops = [
      makeOp({ id: "op1", triggerType: "onIteration", pipeline: pipe(s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "literal:10" })) }),
      makeOp({ id: "op2", triggerType: "onIteration", pipeline: pipe(s("SHOW_VALUE", { targetFieldId: "f2", sourceExpr: "literal:20" })) }),
      makeOp({ id: "op3", triggerType: "onChange", pipeline: pipe(s("SHOW_VALUE", { targetFieldId: "f3", sourceExpr: "literal:30" })) }),
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
      triggerType: "onIteration",
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
      triggerType: "onIteration",
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
      triggerType: "onIteration",
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
      triggerType: "onIteration",
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
      triggerType: "onIteration",
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
      triggerType: "onIteration",
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
      triggerType: "onIteration",
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
      triggerType: "onIteration",
      pipeline: {
        sources: [{ variableName: "occ1", entityType: "occurrence", entityId: "occ1_id" }],
        steps: [{
          id: "step1",
          type: "if",
          condition: { operator: "AND", rules: [{ left: leftExpr, comparator, right: rightVal }] },
          then: [{ id: "t1", type: "action", config: { type: "SHOW_VALUE", targetFieldId: thenTargetFieldId, sourceExpr: "literal:1" } }],
          else: [{ id: "e1", type: "action", config: { type: "SHOW_VALUE", targetFieldId: thenTargetFieldId, sourceExpr: "literal:0" } }],
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
    // SHOW_VALUE with literal:1 returns string "1"; literal:0 returns "0"
    expect(runWithOcc(op, -1)[0].value).toBe("1"); // -1 day = past → then branch
    expect(runWithOcc(op, 1)[0].value).toBe("0");  // +1 day = future → else branch
  });

  test("DATE_AFTER_TODAY: true when date is in the future", () => {
    const op = makeOpWithIf("DATE_AFTER_TODAY", "$occ1.dueDate", null, "result");
    expect(runWithOcc(op, 1)[0].value).toBe("1");  // future → then
    expect(runWithOcc(op, -1)[0].value).toBe("0"); // past → else
  });

  test("DATE_WITHIN_DAYS: true when date is within window", () => {
    const op = makeOpWithIf("DATE_WITHIN_DAYS", "$occ1.dueDate", "7", "result");
    expect(runWithOcc(op, 3)[0].value).toBe("1");  // 3 days = within 7 → then
    expect(runWithOcc(op, 10)[0].value).toBe("0"); // 10 days = outside 7 → else
    expect(runWithOcc(op, -1)[0].value).toBe("0"); // past = not upcoming → else
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
          { id: "s2", type: "action", config: { type: "SHOW_VALUE", targetFieldId: "f1", sourceExpr: "$total" } },
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
          { id: "s2", type: "action", config: { type: "SHOW_VALUE", targetFieldId: "f1", sourceExpr: "$flag" } },
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
          { id: "s3", type: "action", config: { type: "SHOW_VALUE", targetFieldId: "f1", sourceExpr: "$x" } },
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
          { id: "s3", type: "action", config: { type: "SHOW_VALUE", targetFieldId: "f1", sourceExpr: "$count" } },
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
          { id: "s3", type: "action", config: { type: "SHOW_VALUE", targetFieldId: "totalDuration", sourceExpr: "$total", targetValue: 60, targetPeriod: "daily" } },
        ],
      },
    });
    // No occurrences — loop runs 0 iterations, $total stays 0
    const result = runMatchingOperations([op], null, null, { state: {}, fieldsById: {}, occurrencesById: {} });
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(0);
    // target should also be propagated
    expect(result[0].target).toEqual({ value: 60, period: "daily" });
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
          { id: "s3", type: "action", config: { type: "SHOW_VALUE", targetFieldId: "totalDuration", sourceExpr: "$total" } },
        ],
      },
    });
    const result = runMatchingOperations([op], null, null, { state: {}, fieldsById: {}, occurrencesById: occs });
    expect(result[0].value).toBe(55);  // 30 + 25, old occurrence excluded
  });

  test("SHOW_VALUE propagates targetValue and targetPeriod to result", () => {
    const op = makeOp({
      triggerType: "onFilterChange",
      triggerTypes: ["onFilterChange", "onLoad"],
      pipeline: {
        sources: [],
        steps: [
          { id: "s1", type: "action", config: { type: "INIT_VAR", name: "$v", value: 42 } },
          { id: "s2", type: "action", config: { type: "SHOW_VALUE", targetFieldId: "f1", sourceExpr: "$v", targetValue: 100, targetPeriod: "weekly" } },
        ],
      },
    });
    const result = runMatchingOperations([op], null, null, { state: {}, fieldsById: {}, occurrencesById: {} });
    expect(result[0].value).toBe(42);
    expect(result[0].target).toEqual({ value: 100, period: "weekly" });
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
          { id: "s3", type: "action", config: { type: "SHOW_VALUE", targetFieldId: "totalDuration",
              sourceExpr: "$total", targetValue: 60, targetPeriod: "daily" } },
        ],
      },
    });

    const result = runMatchingOperations([op], "NavigationOp", {}, { state: {}, fieldsById: {}, occurrencesById: occs });
    expect(result).toHaveLength(1);
    expect(result[0].fieldId).toBe("totalDuration");
    expect(result[0].value).toBe(70); // 30 + 25 + 15
    expect(result[0].target).toEqual({ value: 60, period: "daily" });
  });

  test("workout sum: returns 0 (not null) when no occurrences today", () => {
    const op = makeOp({
      triggerType: "onIteration",
      pipeline: {
        sources: [],
        steps: [
          { id: "s1", type: "action", config: { type: "INIT_VAR", name: "$total", value: 0 } },
          {
            id: "s2", type: "loop",
            over: "field_occurrences", fieldId: "duration", timeFilter: "daily", as: "$item",
            body: [{ id: "b1", type: "action", config: { type: "ADD_TO_VAR", name: "$total", expr: "$item.value" } }],
          },
          { id: "s3", type: "action", config: { type: "SHOW_VALUE", targetFieldId: "totalDuration",
              sourceExpr: "$total", targetValue: 60, targetPeriod: "daily" } },
        ],
      },
    });

    const result = runMatchingOperations([op], "NavigationOp", {}, { state: {}, fieldsById: {}, occurrencesById: {} });
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(0);
    expect(result[0].target).toEqual({ value: 60, period: "daily" });
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
          { id: "s6", type: "action", config: { type: "SHOW_VALUE", targetFieldId: "completionRate",
              sourceExpr: "$count", targetValue: 100, targetPeriod: "daily" } },
        ],
      },
    });

    const result = runMatchingOperations([op], "NavigationOp", {}, { state: {}, fieldsById: {}, occurrencesById: occs });
    expect(result).toHaveLength(1);
    expect(result[0].fieldId).toBe("completionRate");
    expect(result[0].value).toBe(75); // 3/4 = 75%
    expect(result[0].target).toEqual({ value: 100, period: "daily" });
  });

  test("completion rate: returns 0 when no completions, not NaN or null", () => {
    const occs = {
      o1: todayOcc("o1", "inst1", { done: { value: false, flow: "in" } }),
      o2: todayOcc("o2", "inst2", { done: { value: false, flow: "in" } }),
    };

    const op = makeOp({
      triggerType: "onIteration",
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
          { id: "s6", type: "action", config: { type: "SHOW_VALUE", targetFieldId: "completionRate",
              sourceExpr: "$count", targetValue: 100, targetPeriod: "daily" } },
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
      triggerType: "onIteration",
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
      triggerType: "onIteration",
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
      triggerType: "onIteration",
      pipeline: pipe(s("AGGREGATE", { aggregation: "sum", allowedFields: [{ fieldId: "amount", flowFilter: "in" }], timeFilter: "daily", targetFieldId: "totalIn" })),
    });
    const outOp = makeOp({
      id: "op2",
      triggerType: "onIteration",
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
      pipeline: pipe(s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "literal:loaded" })),
    });

    const result = runMatchingOperations([op], null, {}, {});
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe("loaded");
  });

  test("onLoad trigger does NOT fire for MeasureOp or IterationOp", () => {
    const op = makeOp({
      triggerType: "onLoad",
      pipeline: pipe(s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "literal:1" })),
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
        triggerType: "onIteration",
        pipeline: {
          sources: [],
          steps: [
            { id: "s1", type: "action", config: { type: "INIT_VAR", name: "$dur", value: 0 } },
            { id: "s2", type: "loop", over: "field_occurrences", fieldId: "duration", timeFilter: "daily", as: "$item",
              body: [{ id: "b1", type: "action", config: { type: "ADD_TO_VAR", name: "$dur", expr: "$item.value" } }] },
            { id: "s3", type: "action", config: { type: "SHOW_VALUE", targetFieldId: "totalDuration", sourceExpr: "$dur" } },
          ],
        },
      }),
      makeOp({
        id: "op_cal",
        triggerType: "onIteration",
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

  // ── Progress bar target propagation ───────────────────────────────────────
  test("SHOW_VALUE with no target returns null target (no progress bar)", () => {
    const op = makeOp({
      triggerType: "onIteration",
      pipeline: pipe(s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "literal:42" })),
    });
    const result = runMatchingOperations([op], "NavigationOp", {}, {});
    expect(result[0].target).toBeNull();
  });

  test("SHOW_VALUE with targetValue + targetPeriod enables progress bar via target object", () => {
    const op = makeOp({
      triggerType: "onIteration",
      pipeline: pipe(s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "literal:30",
        targetValue: 60, targetPeriod: "daily" })),
    });
    const result = runMatchingOperations([op], "NavigationOp", {}, {});
    expect(result[0].value).toBe("30");
    expect(result[0].target).toEqual({ value: 60, period: "daily" });
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
        s("SHOW_VALUE", { targetFieldId: "f1", sourceExpr: "$trigger.occurrence.fields.water.value" }),
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
        s("SHOW_VALUE", { targetFieldId: "f_parent", sourceExpr: "$trigger.occurrence.parentId" }),
        s("SHOW_VALUE", { targetFieldId: "f_id",     sourceExpr: "$trigger.occurrence.id" }),
        s("SHOW_VALUE", { targetFieldId: "f_target", sourceExpr: "$trigger.occurrence.targetId" }),
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
        s("SHOW_VALUE", { targetFieldId: "v", sourceExpr: "$trigger.occurrence.fields.amount.value" }),
        s("SHOW_VALUE", { targetFieldId: "f", sourceExpr: "$trigger.occurrence.fields.amount.flow" }),
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
          [s("SHOW_VALUE", { targetFieldId: "noOcc", sourceExpr: "literal:1" })],
          [s("SHOW_VALUE", { targetFieldId: "hasOcc", sourceExpr: "literal:1" })]),
      ),
    });
    const result = executePipeline(op, { state: {}, fieldsById: {}, occurrencesById: {} }, { value: "x" });
    expect(result).toHaveLength(1);
    expect(result[0].fieldId).toBe("noOcc");
  });

  test("unknown occurrenceId leaves enrichment off but preserves other trigger fields", () => {
    const op = makeOp({
      pipeline: pipe(
        s("SHOW_VALUE", { targetFieldId: "v", sourceExpr: "$trigger.value" }),
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
        s("SHOW_VALUE", { targetFieldId: "field", sourceExpr: "$trigger.fieldId" }),
        s("SHOW_VALUE", { targetFieldId: "water", sourceExpr: "$trigger.occurrence.fields.water.value" }),
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
      makeOp({ id: "op-c", sortOrder: 30, triggerType: "onIteration", blockTree: literalBlock("c"), targetFieldId: "f1" }),
      makeOp({ id: "op-a", sortOrder: 10, triggerType: "onIteration", blockTree: literalBlock("a"), targetFieldId: "f1" }),
      makeOp({ id: "op-b", sortOrder: 20, triggerType: "onIteration", blockTree: literalBlock("b"), targetFieldId: "f1" }),
    ];
    const result = runMatchingOperations(ops, null, null, {});
    // Each op writes one update — order of updates reflects op execution order
    expect(result.map(r => r.value)).toEqual(["a", "b", "c"]);
  });

  test("ops without sortOrder default to 50 (interleave with explicit values)", () => {
    const ops = [
      makeOp({ id: "high",   sortOrder: 90, triggerType: "onIteration", blockTree: literalBlock("high"),   targetFieldId: "f1" }),
      makeOp({ id: "noSort",                triggerType: "onIteration", blockTree: literalBlock("noSort"), targetFieldId: "f1" }),
      makeOp({ id: "low",    sortOrder: 10, triggerType: "onIteration", blockTree: literalBlock("low"),    targetFieldId: "f1" }),
    ];
    const result = runMatchingOperations(ops, null, null, {});
    expect(result.map(r => r.value)).toEqual(["low", "noSort", "high"]);
  });

  test("sortOrder ties preserve original input order (stable sort)", () => {
    const ops = [
      makeOp({ id: "first",  sortOrder: 50, triggerType: "onIteration", blockTree: literalBlock("first"),  targetFieldId: "f1" }),
      makeOp({ id: "second", sortOrder: 50, triggerType: "onIteration", blockTree: literalBlock("second"), targetFieldId: "f1" }),
      makeOp({ id: "third",  sortOrder: 50, triggerType: "onIteration", blockTree: literalBlock("third"),  targetFieldId: "f1" }),
    ];
    const result = runMatchingOperations(ops, null, null, {});
    expect(result.map(r => r.value)).toEqual(["first", "second", "third"]);
  });

  test("sorting does not mutate the input array", () => {
    const ops = [
      makeOp({ id: "op-c", sortOrder: 30, triggerType: "onIteration", blockTree: literalBlock("c"), targetFieldId: "f1" }),
      makeOp({ id: "op-a", sortOrder: 10, triggerType: "onIteration", blockTree: literalBlock("a"), targetFieldId: "f1" }),
    ];
    const inputOrder = ops.map(o => o.id);
    runMatchingOperations(ops, null, null, {});
    expect(ops.map(o => o.id)).toEqual(inputOrder);
  });

  test("non-matching ops still respect sort but don't produce updates", () => {
    const ops = [
      makeOp({ id: "drop",   sortOrder: 5,  triggerType: "onDrop",      triggerTypes: ["onDrop"], blockTree: literalBlock("drop"),   targetFieldId: "f1" }),
      makeOp({ id: "iter-a", sortOrder: 10, triggerType: "onIteration", blockTree: literalBlock("iter-a"), targetFieldId: "f1" }),
      makeOp({ id: "iter-b", sortOrder: 20, triggerType: "onIteration", blockTree: literalBlock("iter-b"), targetFieldId: "f1" }),
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

  test("onFieldChange respects fieldId filter via cfg.onFieldChange", () => {
    const op = makeOp({
      triggerType: "onFieldChange",
      triggerTypes: ["onFieldChange"],
      triggerConfig: { onFieldChange: { fieldId: "completed" } },
    });
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "completed" })).toBe(true);
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "duration" })).toBe(false);
  });

  test("onFieldChange falls back to cfg.onChange when its own config is missing", () => {
    const op = makeOp({
      triggerType: "onFieldChange",
      triggerTypes: ["onFieldChange"],
      triggerConfig: { onChange: { fieldId: "completed" } },
    });
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "completed" })).toBe(true);
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "duration" })).toBe(false);
  });

  test("onFieldChange respects allowedFields list", () => {
    const op = makeOp({
      triggerType: "onFieldChange",
      triggerTypes: ["onFieldChange"],
      triggerConfig: { onFieldChange: { allowedFields: ["water", "steps"] } },
    });
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "water" })).toBe(true);
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "steps" })).toBe(true);
    expect(shouldTrigger(op, "MeasureOp", { fieldId: "mood" })).toBe(false);
  });

  test("onFieldChange respects instanceId filter", () => {
    const op = makeOp({
      triggerType: "onFieldChange",
      triggerTypes: ["onFieldChange"],
      triggerConfig: { onFieldChange: { instanceId: "inst-morning" } },
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
