import { describe, it, expect, vi } from "vitest";
import { matchModuleScope, runMatchingOperations } from "../helpers/operationExecutor.js";

describe("trigger module scope", () => {
  it("fires only for an occurrence of a named module; unknown module does not fire", () => {
    const to = { eventType: "onChange", moduleIds: ["mEx"] };
    expect(matchModuleScope(to, { _occModuleId: "mEx" })).toBe(true);
    expect(matchModuleScope(to, { _occModuleId: "mOther" })).toBe(false);
    expect(matchModuleScope(to, {})).toBe(false);
    expect(matchModuleScope({ eventType: "onChange" }, {})).toBe(true);
  });
});

describe("trigger wait", () => {
  const op = (waitMs) => ({
    id: "op1", name: "op", enabled: true, triggerTypes: ["onAdd"],
    triggerObjects: [{ eventType: "onAdd", ...(waitMs ? { waitMs } : {}) }],
    pipeline: { steps: [{ type: "action", config: { type: "SHOW_VALUE", name: "$x", value: "literal:1" } }] },
  });
  const ctx = (debounce) => ({ state: { grid: {} }, occurrencesById: {}, modulesById: {}, fieldsById: {}, operationsById: {}, _debounce: debounce });

  it("hands a waiting trigger to the delayed runner instead of running it", () => {
    const debounce = vi.fn();
    runMatchingOperations([op(500)], "OccurrenceCreateOp", { occurrenceId: "o" }, ctx(debounce));
    expect(debounce).toHaveBeenCalledWith("op1", 500, "OccurrenceCreateOp", expect.objectContaining({ occurrenceId: "o" }));
  });

  it("the delayed re-run (named op) runs it; other ops are skipped", () => {
    const debounce = vi.fn();
    const other = { ...op(0), id: "op2" };
    const ups = runMatchingOperations([op(500), other], "OccurrenceCreateOp", { occurrenceId: "o", _onlyOpId: "op1" }, ctx(debounce));
    expect(debounce).not.toHaveBeenCalled();
    expect(ups.length).toBeGreaterThan(0);
  });
});

import { changeTouchesOp } from "../helpers/operationExecutor.js";
describe("skip a field change the op doesn't read", () => {
  const op = { id: "o", pipeline: { steps: [{ type: "action", config: { type: "FIND", over: "$allInstances",
    predicate: { operator: "AND", rules: [{ left: "fields.fWater.value", comparator: "IS_NOT_EMPTY" }] } } }] } };
  const ctx = { fieldsById: { fWater: { id: "fWater" }, fOther: { id: "fOther" } } };
  it("runs for a field it reads, not for one it doesn't, and always for other events", () => {
    expect(changeTouchesOp(op, "MeasureOp", { fields: { fWater: 1 } }, ctx)).toBe(true);
    expect(changeTouchesOp(op, "MeasureOp", { fields: { fOther: 1 } }, ctx)).toBe(false);
    expect(changeTouchesOp(op, "OccurrenceCreateOp", {}, ctx)).toBe(true);
  });
});
