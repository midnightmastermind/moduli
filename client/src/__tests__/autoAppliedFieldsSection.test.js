// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { nextAutoApplied } from "../ui/AutoAppliedFieldsSection.jsx";

describe("nextAutoApplied — an edit starts from what is inherited (the cascade is nearest-wins)", () => {
  it("adding to an inheriting level keeps what it inherited", () => {
    expect(nextAutoApplied({ own: null, inherited: ["tags", "date"], add: "completed" })).toEqual(["tags", "date", "completed"]);
  });
  it("removing from an inheriting level writes the rest", () => {
    expect(nextAutoApplied({ own: null, inherited: ["tags", "date"], remove: "tags" })).toEqual(["date"]);
  });
  it("edits a level's own list; no duplicates; reset goes back to inheriting", () => {
    expect(nextAutoApplied({ own: ["a"], inherited: ["x"], add: "a" })).toEqual(["a"]);
    expect(nextAutoApplied({ own: ["a", "b"], inherited: ["x"], remove: "a" })).toEqual(["b"]);
    expect(nextAutoApplied({ own: ["a"], inherited: ["x"], reset: true })).toBe(null);
  });
});
