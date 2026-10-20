// "Save over" replaced a template with a new root id and left every copy pointing at the deleted one, so the
// copy's next Save over had nothing to write over (watched on test grid 2, 2026-10-20).
import { describe, it, expect } from "vitest";
import { planTemplateRepoint } from "../utils/templateRepoint.js";

describe("planTemplateRepoint", () => {
  const occs = [
    { id: "copyA", meta: { appliedFromTemplateId: "old", x: 1 } },
    { id: "row1", meta: { appliedFromTemplateId: "old" } },
    { id: "other", meta: { appliedFromTemplateId: "elsewhere" } },
    { id: "new", meta: { appliedFromTemplateId: "old", keep: true } },
    { id: "plain", meta: {} },
  ];
  it("points every copy of the old template at the new one, keeping the rest of meta", () => {
    const p = planTemplateRepoint({ oldId: "old", newId: "new", occurrences: occs });
    const byId = Object.fromEntries(p.occurrences.map(o => [o.id, o.meta]));
    expect(byId.copyA).toEqual({ appliedFromTemplateId: "new", x: 1 });
    expect(byId.row1).toEqual({ appliedFromTemplateId: "new" });
    expect(byId.other).toBeUndefined();
    expect(byId.plain).toBeUndefined();
  });
  it("the new template is not a copy of itself", () => {
    const p = planTemplateRepoint({ oldId: "old", newId: "new", occurrences: occs });
    expect(p.occurrences.find(o => o.id === "new").meta).toEqual({ keep: true });
  });
  it("rewrites an operation that names the old template, and leaves others alone", () => {
    const ops = [
      { id: "op1", pipeline: { steps: [{ type: "APPLY_TEMPLATE", config: { templateRef: "old" } }] } },
      { id: "op2", pipeline: { steps: [{ type: "FIND", config: { value: "older" } }] } },
    ];
    const p = planTemplateRepoint({ oldId: "old", newId: "new", operations: ops });
    // "older" contains "old" as a substring — it is not a reference and must not be rewritten.
    expect(p.operations.map(o => o.id)).toEqual(["op1"]);
    expect(p.operations[0].pipeline.steps[0].config.templateRef).toBe("new");
  });
  it("rewrites an id used as a path segment", () => {
    const ops = [{ id: "op3", pipeline: { steps: [{ config: { expr: "$allItemsById.old.label" } }] } }];
    const p = planTemplateRepoint({ oldId: "old", newId: "new", operations: ops });
    expect(p.operations[0].pipeline.steps[0].config.expr).toBe("$allItemsById.new.label");
  });
  it("does nothing when the ids match or are missing", () => {
    expect(planTemplateRepoint({ oldId: "a", newId: "a", occurrences: occs })).toEqual({ occurrences: [], operations: [] });
    expect(planTemplateRepoint({ oldId: null, newId: "b", occurrences: occs })).toEqual({ occurrences: [], operations: [] });
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
describe("save_over_template wiring", () => {
  const src = readFileSync(resolve(process.cwd(), "socketHandlers/templates.js"), "utf8");
  const body = src.slice(src.indexOf('socket.on("save_over_template"'));
  it("signs the new template's nodes from the copy and repoints what named the old template", () => {
    expect(body).toMatch(/stampSignatures: true, signRoot: false/);
    expect(body).toMatch(/planTemplateRepoint\(\{/);
    expect(body).toMatch(/Operation\.updateOne\(\{ id \}, \{ \$set: \{ pipeline \} \}\)/);
  });
});
