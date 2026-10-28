// An optional form input (Include box) reaches $form.fields only when included,
// and a Create with fieldsFrom binds + sets exactly those (2026-10-28).
import { describe, it, expect } from "vitest";
import { answersToResult, hasAnswer } from "../helpers/formItems.js";
import { executePipeline } from "../helpers/operationExecutor";

const items = [
  { key: "name", label: "Name", required: true },
  { key: "due", label: "Due", fieldId: "f-due", optional: true },
  { key: "people", label: "People", fieldId: "f-people", optional: true },
  { key: "size", label: "Size", fieldId: "f-size" },
];

describe("optional form inputs", () => {
  it("an included input lands in fields, a left-out one does not", () => {
    const r = answersToResult(items, { name: "Call Sam", due: "2026-11-01", size: 3 });
    expect(r.fields).toEqual({ "f-due": "2026-11-01", "f-size": 3 });
    expect(r.values.people).toBe(null);
  });
  it("a left-out input with a typed value is still left out", () => {
    const r = answersToResult(items, { name: "x" });
    expect(r.fields).toEqual({ "f-size": null });
  });
  it("a value counts as something in it unless it is empty or false", () => {
    expect([hasAnswer(""), hasAnswer([]), hasAnswer(null), hasAnswer(false), hasAnswer("a"), hasAnswer(0)]).toEqual([false, false, false, false, true, true]);
  });
});

describe("CREATE fieldsFrom", () => {
  const run = (cfg, vars) => {
    const op = { id: "op", name: "t", pipeline: { steps: [
      { id: "s0", type: "action", config: { type: "INIT_VAR", name: "$form", expr: `json:${JSON.stringify(vars)}` } },
      { id: "s1", type: "action", config: { type: "CREATE", role: "instance", name: "Thing", parent: "literal:p", newModule: true, ...cfg } },
    ] } };
    const occurrencesById = { p: { id: "p", role: "container", moduleId: "mp", occurrences: [] } };
    const modulesById = { mp: { id: "mp", role: "container", kind: "board" } };
    const ctx = { state: { grid: { _id: "g" }, gridId: "g", modules: [], occurrencesById, modulesById, fields: [], fieldsById: {} }, occurrencesById, modulesById, fieldsById: {} };
    return executePipeline(op, ctx, {}) || [];
  };
  it("binds and sets every non-empty entry, and an explicit field wins", () => {
    const ups = run({ fieldsFrom: "$form.fields", fields: { "f-size": "literal:9" } }, { fields: { "f-due": "2026-11-01", "f-people": [], "f-size": 3, "f-x": "" } });
    const create = ups.find((u) => u._effect === "CREATE_ITEM");
    const json = JSON.stringify(create);
    expect(json).toContain('"f-due"');
    expect(json).not.toContain('"f-people"');
    expect(json).not.toContain('"f-x"');
    expect(create.template.fieldBindings.map((b) => b.fieldId).sort()).toEqual(["f-due", "f-size"]);
    expect(create.instance.fields["f-size"].value).toBe(9);
  });
});
