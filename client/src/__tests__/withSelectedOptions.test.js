// A picked occurrence past the dropdown's 100-option window still has an option
// (user, 2026-09-26: birthday cards' People field showed only one of five).
import { describe, it, expect } from "vitest";
import { withSelectedOptions } from "../ui/FieldRenderer";

const field = { type: "occurrence" };
const occs = { p9: { id: "p9", moduleId: "m9" }, p1: { id: "p1", moduleId: "m1" } };
const mods = { m9: { label: "Natalie Lonergan" }, m1: { label: "Sari Lee" } };
const get = () => occs;

describe("withSelectedOptions", () => {
  it("adds a picked person the list does not reach, by name", () => {
    const out = withSelectedOptions([{ value: "p1", label: "Sari Lee" }], field, "p9", get, mods);
    expect(out).toEqual([{ value: "p1", label: "Sari Lee" }, { value: "p9", label: "Natalie Lonergan" }]);
  });
  it("leaves the list alone when every pick is already there", () => {
    const opts = [{ value: "p1", label: "Sari Lee" }];
    expect(withSelectedOptions(opts, field, "p1", get, mods)).toBe(opts);
  });
  it("ignores a pick that no longer exists, and non-occurrence fields", () => {
    expect(withSelectedOptions([], field, "gone", get, mods)).toEqual([]);
    const opts = [];
    expect(withSelectedOptions(opts, { type: "select" }, "p9", get, mods)).toBe(opts);
  });
});
