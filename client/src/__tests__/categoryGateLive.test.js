// The category gate as it exists on the LIVE grid after 0164 — read verbatim out of
// poms grid, then driven through the REAL evaluator. The policy suite tests the gate
// the generator EMITS; this one tests the gate that actually shipped.
import { describe, it, expect } from "vitest";
import { evalGroup } from "../helpers/operationActions";

// The gate read VERBATIM out of poms grid after 0164 applied.
const LIVE = {"id":"1zs0pelhyfn","operator":"OR","rules":[{"id":"fz2j0ui2d5l","left":"$item.fields.CvJsK3lNu6_e.value","comparator":"CONTAINS","right":"$goalCategory"},{"id":"qduyl9d5ft","left":"$goalCategory","comparator":"IS_EMPTY","right":""}]};
const item = (tags) => ({ fields: { CvJsK3lNu6_e: { value: tags } } });

describe("the live category gate", () => {
  it("is INERT while no category is picked", () => {
    expect(evalGroup(LIVE, { $item: item(["physical"]), $goalCategory: undefined })).toBe(true);
    expect(evalGroup(LIVE, { $item: item(["financial"]), $goalCategory: undefined })).toBe(true);
    expect(evalGroup(LIVE, { $item: item([]), $goalCategory: undefined })).toBe(true);
  });
  it("DISCRIMINATES once one is", () => {
    expect(evalGroup(LIVE, { $item: item(["physical"]), $goalCategory: "physical" })).toBe(true);
    expect(evalGroup(LIVE, { $item: item(["financial"]), $goalCategory: "physical" })).toBe(false);
  });
  it("matches a multi-tag row on membership, not equality", () => {
    expect(evalGroup(LIVE, { $item: item(["ingredient", "grocery"]), $goalCategory: "grocery" })).toBe(true);
  });
});
