// $trigger.occurrence names the pressed occurrence: label, role, kind and children, beside id/fields/ancestors.
import { describe, it, expect } from "vitest";
import { runMatchingOperations } from "../helpers/operationExecutor.js";
import { getTriggerVars } from "../helpers/triggerTypes.js";

const show = (name, expr) => ({ id: name, type: "action", config: { type: "SHOW_VALUE", name, value: expr } });
const op = {
  id: "op1", name: "Inspect", enabled: true, triggerTypes: ["onButton"], triggerObjects: [{ eventType: "onButton" }],
  pipeline: { steps: [
    show("label", "$trigger.occurrence.label"), show("role", "$trigger.occurrence.role"),
    show("kind", "$trigger.occurrence.kind"), show("kids", "$trigger.occurrence.occurrences"),
  ] },
};
const ctx = (occs) => ({
  state: { grid: { _id: "g" }, modules: [], occurrences: [] }, fieldsById: {}, operationsById: {},
  occurrencesById: occs,
  modulesById: { cm: { id: "cm", role: "container", kind: "board", label: "Movies" } },
});
const values = (updates) => Object.fromEntries(updates.filter((u) => u._effect === "SHOW_VALUE" || u.name).map((u) => [String(u.name).replace(/^\$/, ""), u.value]));

describe("$trigger.occurrence for a button press", () => {
  it("carries the pressed occurrence's label, role, kind and child ids", () => {
    const occs = { c1: { id: "c1", moduleId: "cm", occurrences: ["a", "b"], fields: {} } };
    const out = values(runMatchingOperations([op], "ButtonOp", { type: "ButtonOp", operationId: "op1", occurrenceId: "c1" }, ctx(occs)));
    expect(out).toEqual({ label: "Movies", role: "container", kind: "board", kids: ["a", "b"] });
  });
  it("a placement's own label wins over its module's", () => {
    const occs = { c1: { id: "c1", moduleId: "cm", label: "My movies", fields: {} } };
    const out = values(runMatchingOperations([op], "ButtonOp", { type: "ButtonOp", operationId: "op1", occurrenceId: "c1" }, ctx(occs)));
    expect(out.label).toBe("My movies");
    expect(out.kids).toEqual([]);
  });
  it("the editor offers the pressed occurrence for an onButton trigger", () => {
    const vars = getTriggerVars("onButton", "module");
    expect(vars).toEqual(expect.arrayContaining(["$trigger.occurrenceId", "$trigger.occurrence", "$trigger.fieldId"]));
  });
});
