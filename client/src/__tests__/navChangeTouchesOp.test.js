// A local filter change on a non-date field skips ops that never mention it (2026-11-11: a Relationship pick on
// People ran six date ops, ~0.4s). Date changes and changes that name no field still run everything.
import { describe, it, expect } from "vitest";
import { navChangeTouchesOp, runMatchingOperations } from "../helpers/operationExecutor";

const fieldsById = { rel: { id: "rel", name: "Relationship", type: "select" }, date: { id: "date", name: "Date", type: "date" } };
const navTrig = [{ eventType: "onFilterChange", subjectType: "filterNav", targetId: "", priority: 1 }];
const dateOp = { id: "d", name: "Fill Day", enabled: true, triggerObjects: navTrig,
  pipeline: { steps: [{ type: "action", config: { type: "INIT_VAR", name: "$x", expr: "$activePeriodDates" } }] } };
const relOp = { id: "r", name: "Reads rel", enabled: true, triggerObjects: navTrig,
  pipeline: { steps: [{ type: "action", config: { type: "INIT_VAR", name: "$x", expr: "$pg._effectiveFilter.rel" } }] } };
const ctx = { fieldsById };

describe("navChangeTouchesOp", () => {
  it("skips an op that never mentions a changed non-date field", () => {
    expect(navChangeTouchesOp(dateOp, { changedFieldIds: ["rel"] }, ctx)).toBe(false);
  });
  it("runs an op that names the field", () => {
    expect(navChangeTouchesOp(relOp, { changedFieldIds: ["rel"] }, ctx)).toBe(true);
  });
  it("runs every op on a date change", () => {
    expect(navChangeTouchesOp(dateOp, { changedFieldIds: ["date"] }, ctx)).toBe(true);
    expect(navChangeTouchesOp(dateOp, { changedFieldIds: ["rel", "date"] }, ctx)).toBe(true);
  });
  it("runs when no fields are named, or a field is unknown", () => {
    expect(navChangeTouchesOp(dateOp, {}, ctx)).toBe(true);
    expect(navChangeTouchesOp(dateOp, { changedFieldIds: [] }, ctx)).toBe(true);
    expect(navChangeTouchesOp(dateOp, { changedFieldIds: ["gone"] }, ctx)).toBe(true);
  });
  it("the sweep leaves the skipped op out", () => {
    const step = (config) => ({ type: "action", config });
    const writer = (id, name, fid, extra) => ({ id, name, enabled: true, triggerTypes: ["onFilterChange"], triggerObjects: navTrig, pipeline: { steps: [
      step({ type: "INIT_VAR", name: "$o", expr: "$allItemsById.o1" }),
      ...(extra ? [step({ type: "INIT_VAR", name: "$r", expr: extra })] : []),
      step({ type: "UPDATE", path: `$o.fields.${fid}.value`, value: "literal:x" }),
    ] } });
    const ops = [writer("d", "date op", "a", "$activePeriodDates"), writer("r", "rel op", "b", "$o._effectiveFilter.rel")];
    const occurrencesById = { o1: { id: "o1", moduleId: "m", fields: { a: { value: "" }, b: { value: "" } }, occurrences: [] } };
    const modulesById = { m: { id: "m", role: "instance", fieldBindings: [{ fieldId: "a" }, { fieldId: "b" }] } };
    const fb = { ...fieldsById, a: { id: "a", type: "text" }, b: { id: "b", type: "text" } };
    const out = runMatchingOperations(ops, "NavigationOp", { type: "NavigationOp", sourceOccurrenceId: "o1", occurrenceId: "o1", changedFieldIds: ["rel"] },
      { state: { grid: {}, modules: Object.values(modulesById) }, fieldsById: fb, occurrencesById, modulesById, operationsById: {} });
    const by = new Set(out.map((e) => e._sourceOpId));
    expect(by.has("r"), "the op naming the field ran").toBe(true);
    expect(by.has("d"), "the date op was skipped").toBe(false);
  });
});
