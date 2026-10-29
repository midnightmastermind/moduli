import { describe, it, expect } from "vitest";
import { planFillLast } from "../migrations/0456-trackers-last-line-fills.mjs";

const occ = (id, lc, kids = []) => [id, { id, occurrences: kids, meta: lc ? { layoutCascade: lc } : {} }];

describe("0456 planFillLast", () => {
  it("picks filled wrap layouts under the page, nested ones too", () => {
    const byId = new Map([
      occ("page", null, ["a", "b"]),
      occ("a", { mode: "wrap", childFill: true }, ["c"]),
      occ("c", { mode: "wrap", childFill: true }),
      occ("b", { mode: "wrap", childFill: true, childFillLast: true }),
    ]);
    expect(planFillLast("page", byId).sort()).toEqual(["a", "c"]);
  });
  it("leaves unfilled, non-wrap and outside layouts alone (control)", () => {
    const byId = new Map([
      occ("page", null, ["a", "b"]),
      occ("a", { mode: "wrap" }),
      occ("b", { mode: "stack", childFill: true }),
      occ("elsewhere", { mode: "wrap", childFill: true }),
    ]);
    expect(planFillLast("page", byId)).toEqual([]);
  });
});
