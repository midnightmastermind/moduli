/**
 * triggerFieldVars.test.js
 *
 * $trigger.value WAS ALWAYS UNDEFINED FOR A FIELD-CHANGE TRIGGER.
 *
 * Found building an operation through the UI on the rebuild grid (2026-09-22):
 * trigger = On Change · Field · Done, and the condition row PRE-FILLS its left
 * side with `$trigger › value`. The editor's trigger hint advertises the same
 * list — `$trigger.fieldId · $trigger.itemId · $trigger.value ·
 * $trigger.previousValue · $trigger.flow`. Measured through the UI:
 *
 *   untick Done   Logged On "2026-09-21" -> null   (the ELSE branch)
 *   tick Done     Logged On null         -> null   (the ELSE branch AGAIN)
 *
 * Both branches took `else` because `String(undefined) !== "true"`. Every
 * MeasureOp emitter carries the change as `fields: { [fieldId]: value }` —
 * CommitHelpers' two sites and bindSocketToStore's echo path — and nothing
 * lifted that into `$trigger.value`, `$trigger.fieldId` or `$trigger.flow`.
 *
 * Measured over all 235 live operations before changing it: 105 use
 * `$trigger.occurrence` (the path that works), 2 use `$trigger.fieldId` and 2
 * `$trigger.value` — all four as guards that could never pass, on two grids.
 * So this enriches what was dead; it cannot change an op that was working.
 *
 * THE TWO EMITTER SHAPES ARE BOTH REAL and the enrichment has to read both:
 *   CommitHelpers        fields: { [id]: value }          (the raw value)
 *   bindSocketToStore    fields: { [id]: { value, flow } } (the stored cell)
 *
 * NOT FIXED, and stated rather than implied: `$trigger.previousValue` is still
 * undefined. No emitter carries a before-value — fireOperations runs after the
 * local occurrence is already updated — so populating it means changing the
 * three call sites, not the executor.
 */
import { describe, it, expect } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";

const DONE = "f-done", STAMP = "f-stamp";

/** The op the UI builds: if the changed value is true, stamp a date. */
const pipeline = {
  sources: [],
  steps: [
    {
      id: "if", type: "if",
      condition: { operator: "AND", rules: [{ id: "r", left: "$trigger.value", comparator: "IS", right: "true" }] },
      then: [{ id: "t", type: "action", config: { type: "SET_FIELD_VALUE", fieldId: STAMP, valueExpr: "literal:stamped" } }],
      else: [{ id: "e", type: "action", config: { type: "SET_FIELD_VALUE", fieldId: STAMP, valueExpr: null } }],
    },
  ],
};

/** Same shape, but guarding on which field changed. */
const fieldIdPipeline = {
  sources: [],
  steps: [
    {
      id: "if", type: "if",
      condition: { operator: "AND", rules: [{ id: "r", left: "$trigger.fieldId", comparator: "IS", right: DONE }] },
      then: [{ id: "t", type: "action", config: { type: "SET_FIELD_VALUE", fieldId: STAMP, valueExpr: "literal:matched" } }],
      else: [],
    },
  ],
};

function run(pipe, fields) {
  const occurrencesById = {
    ROW: { id: "ROW", moduleId: "m-row", fields: { [DONE]: { value: true, flow: "in" } } },
  };
  const modulesById = { "m-row": { id: "m-row", role: "instance" } };
  const ctx = {
    state: { grid: { _id: "g" }, gridId: "g", fields: [], modules: Object.values(modulesById),
      occurrencesById, modulesById, fieldsById: {}, operationsById: {}, operations: [] },
    fieldsById: {}, occurrencesById, modulesById, operationsById: {}, operations: [],
  };
  const tx = { type: "MeasureOp", occurrenceId: "ROW", instanceId: "m-row", fields };
  const out = executePipeline({ id: "op", name: "Stamp", pipeline: pipe }, ctx, tx, {});
  const effects = Array.isArray(out) ? out : (out?.effects || out?.updates || []);
  return effects
    .filter((e) => e.fieldId === STAMP || e.occurrence?.fields?.[STAMP] !== undefined)
    .map((e) => e.value ?? e.occurrence?.fields?.[STAMP]?.value ?? null);
}

describe("$trigger for a field-change trigger", () => {
  it("carries the new value — the raw shape CommitHelpers emits", () => {
    expect(run(pipeline, { [DONE]: true })).toEqual(["stamped"]);
  });

  it("carries it from the {value, flow} shape the socket echo emits too", () => {
    expect(run(pipeline, { [DONE]: { value: true, flow: "in" } })).toEqual(["stamped"]);
  });

  it("carries the field that changed", () => {
    expect(run(fieldIdPipeline, { [DONE]: true })).toEqual(["matched"]);
  });

  it("CONTROL — a false value still takes the else branch", () => {
    expect(run(pipeline, { [DONE]: false })).toEqual([null]);
  });

  it("CONTROL — several fields at once name no single one, so no guess is made", () => {
    // `$trigger.value` cannot mean anything here, and picking the first key
    // would make the guard depend on object key order.
    expect(run(fieldIdPipeline, { [DONE]: true, other: 3 })).toEqual([]);
  });
});
