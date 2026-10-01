// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { addManualOption } from "../ui/commandCenter/SelectOptionsSourceEditor";
describe("addManualOption", () => {
  it("adds a new value", () => { expect(addManualOption(["a"], " b ")).toEqual({ values: ["a", "b"], duplicate: null }); });
  it("refuses a value already there, ignoring case", () => {
    const vals = ["movie", { value: "Series", label: "TV" }];
    expect(addManualOption(vals, "Movie")).toEqual({ values: vals, duplicate: "movie" });
    expect(addManualOption(vals, "series").duplicate).toBe("Series");
  });
  it("ignores an empty draft", () => { const v = ["a"]; expect(addManualOption(v, "  ").values).toBe(v); });
});
