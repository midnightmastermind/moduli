import { describe, it, expect } from "vitest";
import { planFill } from "../migrations/0438-trackers-fill-width.mjs";

describe("0438 planFill", () => {
  const byId = new Map([
    ["p", { id: "p", occurrences: ["a", "b", "x"], meta: { layoutCascade: { mode: "wrap", childMinWidth: 184 } } }],
    ["a", { id: "a", occurrences: ["c"], meta: { layoutCascade: { mode: "wrap", childMinWidth: 184 } } }],
    ["b", { id: "b", occurrences: [], meta: { layoutCascade: { mode: "wrap", childFill: true } } }],
    ["c", { id: "c", occurrences: [], meta: {} }],
    ["x", { id: "x", occurrences: [], meta: { layoutCascade: { mode: "stack" } } }],
    ["outside", { id: "outside", occurrences: [], meta: { layoutCascade: { mode: "wrap" } } }],
  ]);
  it("picks the wraps under the page without fill, and nothing else", () => {
    expect(planFill("p", byId).sort()).toEqual(["a", "p"]);
  });
});
