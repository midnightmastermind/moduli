// A hand-run op (Run now, the button field, an instance Run widget, a
// node-input run) builds its context from state + fieldsById +
// occurrencesById. Actions read `modulesById` off the context and default it
// to {} — so APPLY_TEMPLATE found no module for any template node and cloned
// nothing. Found 2026-10-03: `Project: Create` asked both questions and then
// created no project. executePipeline now derives the lookups from state.
import { describe, it, expect } from "vitest";
import { executePipeline, withEntityLookups } from "../helpers/operationExecutor";

const modules = [
  { id: "mPage", role: "page", kind: "board", label: "Project: {ProjectName}" },
  { id: "mCol", role: "container", kind: "board", label: "Backburner" },
];
const occurrences = [
  { id: "tpl", moduleId: "mPage", parentId: "tplFolder", occurrences: ["col"] },
  { id: "col", moduleId: "mCol", parentId: "tpl", occurrences: [] },
];
const folders = [{ id: "projects", name: "Projects" }];
const state = { modules, occurrences, folders, fields: [], operations: [] };
const occurrencesById = Object.fromEntries(occurrences.map((o) => [o.id, o]));
const op = { id: "op", name: "Project: Create", pipeline: { steps: [
  { id: "s1", type: "action", config: { type: "APPLY_TEMPLATE", templateRef: "tpl", rootParent: "projects", rootLabel: "Project: Alpha" } },
] } };
const creates = (r) => r.filter((e) => e?._effect === "CREATE_ITEM");

describe("hand-run op context", () => {
  it("APPLY_TEMPLATE clones the template when the caller passed no modulesById", () => {
    const r = executePipeline(op, { state, fieldsById: {}, occurrencesById, operationsById: {} }, { type: "manual" });
    expect(creates(r).map((e) => e.template.label).sort()).toEqual(["Backburner", "Project: Alpha"]);
  });
  it("CONTROL: a caller that passes modulesById gets the same clone", () => {
    const modulesById = Object.fromEntries(modules.map((m) => [m.id, m]));
    const r = executePipeline(op, { state, fieldsById: {}, occurrencesById, operationsById: {}, modulesById }, { type: "manual" });
    expect(creates(r)).toHaveLength(2);
  });
  it("withEntityLookups keeps a caller's own maps and fills only what is missing", () => {
    const own = { x: 1 };
    const ctx = withEntityLookups({ state, modulesById: own });
    expect(ctx.modulesById).toBe(own);
    expect(ctx.foldersById.projects.name).toBe("Projects");
  });
});

describe("the lookups are filled on the caller's own context", () => {
  it("does not copy the context (the sweep's $allItems cache lives on it)", () => {
    const ctx = { state };
    expect(withEntityLookups(ctx)).toBe(ctx);
    expect(ctx.modulesById.mPage.label).toBe("Project: {ProjectName}");
  });
});
