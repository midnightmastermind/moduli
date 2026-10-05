import { describe, it, expect } from "vitest";
import { valuesFromMeta, rewriteRule, rewritePipeline } from "../migrations/0391-tracker-flags-become-fields.mjs";
import fs from "node:fs";

const ids = { period: "P", noPrefix: "N" };
describe("0391 tracker flags become fields", () => {
  it("maps meta to field values", () => {
    expect(valuesFromMeta({ cumulative: true })).toEqual({ period: "total" });
    expect(valuesFromMeta({ period: "month" })).toEqual({ period: "month" });
    expect(valuesFromMeta({ noDatePrefix: true })).toEqual({ noPrefix: true });
    expect(valuesFromMeta({})).toEqual({});
  });
  it("rewrites each flag rule with the same meaning", () => {
    expect(rewriteRule({ left: "$grp.meta.noDatePrefix", comparator: "IS_EMPTY", right: "" }, ids)).toMatchObject({ left: "$grp.fields.N.value", comparator: "IS_NOT", right: "true" });
    expect(rewriteRule({ left: "$goal.meta.cumulative", comparator: "IS_EMPTY", right: "" }, ids)).toMatchObject({ left: "$goal.fields.P.value", comparator: "IS_NOT", right: "total" });
    expect(rewriteRule({ left: "$goal2.meta.cumulative", comparator: "IS_NOT_EMPTY", right: "" }, ids)).toMatchObject({ left: "$goal2.fields.P.value", comparator: "IS", right: "total" });
    expect(rewriteRule({ left: "$goal.meta.period", comparator: "IS", right: "month" }, ids)).toMatchObject({ left: "$goal.fields.P.value", comparator: "IS", right: "month" });
    expect(rewriteRule({ left: "$goal.meta.period", comparator: "IS_EMPTY", right: "" }, ids)).toMatchObject({ left: "$goal.fields.P.value", comparator: "IS_EMPTY" });
  });
  it("leaves other rules alone and reaches nested groups and loop bodies", () => {
    const p = { steps: [{ type: "loop", body: [{ type: "if", condition: { operator: "AND", rules: [{ left: "$g.label", comparator: "IS_NOT_EMPTY" }, { operator: "AND", rules: [{ left: "$g.meta.cumulative", comparator: "IS_EMPTY" }] }] }, then: [] }] }] };
    const out = rewritePipeline(p, ids);
    const rules = out.steps[0].body[0].condition.rules;
    expect(rules[0].left).toBe("$g.label");
    expect(rules[1].rules[0].left).toBe("$g.fields.P.value");
  });
  it("the live op's every flag rule is rewritten (fixture: poms' pipeline shape)", () => {
    const live = { steps: [
      { type: "loop", body: [{ type: "if", condition: { rules: [{ left: "$grp.meta.noDatePrefix", comparator: "IS_EMPTY" }] } }] },
      { type: "loop", body: [{ type: "if", condition: { rules: [{ rules: [{ left: "$goal.meta.cumulative", comparator: "IS_EMPTY" }] }, { left: "$goal.meta.period", comparator: "IS_EMPTY" }] } }] },
      { type: "loop", body: [{ type: "if", condition: { rules: [{ left: "$goal2.meta.cumulative", comparator: "IS_NOT_EMPTY" }] } }] },
      { type: "loop", body: [{ type: "if", condition: { rules: [{ rules: [{ left: "$goal.meta.cumulative", comparator: "IS_EMPTY" }] }, { left: "$goal.meta.period", comparator: "IS", right: "month" }] } }] },
    ] };
    expect(JSON.stringify(rewritePipeline(live, ids))).not.toMatch(/\.meta\.(cumulative|period|noDatePrefix)/);
  });
});
