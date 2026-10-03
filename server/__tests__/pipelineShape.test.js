import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import Operation from "../models/Operation.js";
import { normalizeSteps, hasSeedDialect } from "../utils/pipelineShape.js";

const dialect = [{ type: "action", action: "INIT_VAR", cfg: { name: "$x", expr: "1" } },
  { type: "if", condition: { conjunction: "AND", rules: [{ left: "$x", comparator: "IS", right: "1" }] }, then: [{ type: "action", action: "FIND", cfg: { predicate: { conjunction: "AND", rules: [] }, itemIdVar: "$y" } }], else: [] }];

describe("pipelineShape", () => {
  it("rewrites the seed dialect into the editor's shape", () => {
    const s = normalizeSteps(dialect);
    expect(s[0]).toMatchObject({ type: "action", config: { type: "INIT_VAR", name: "$x", expr: "1" } });
    expect(s[0].action).toBeUndefined(); expect(s[0].cfg).toBeUndefined();
    expect(s[1].condition.operator).toBe("AND");
    expect(s[1].then[0].config.predicate).toEqual({ operator: "AND", rules: [] });
    expect(hasSeedDialect(s)).toBe(false);
  });
  it("leaves an editor-shaped pipeline alone", () => {
    const ed = [{ id: "a", type: "action", config: { type: "INIT_VAR", name: "$x", expr: "1" } }];
    expect(normalizeSteps(ed)).toEqual(ed);
  });
  it("the Operation model normalizes on save, so a seed cannot store the dialect", async () => {
    const op = new Operation({ id: "o", userId: "u", gridId: "g", name: "n", pipeline: { steps: dialect } });
    await op.validate();
    // pre("save") runs on save; drive the hook the way save would
    const hooks = Operation.schema.s.hooks;
    const pre = hooks._pres.get("save").find((h) => h.fn.name === "normalizePipelineShape");
    expect(pre).toBeTruthy();
    await pre.fn.call(op);
    expect(hasSeedDialect(op.toObject().pipeline.steps)).toBe(false);
  });
});
