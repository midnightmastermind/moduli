// A manual option list was read only from optionsSource.values; five seeded fields keep it under
// `options` (poms' Schedule Format, the test grids' Cadence), and their dropdowns opened empty.
import { describe, it, expect } from "vitest";
import { resolveOptions, manualValues } from "../helpers/optionsResolver.js";

const field = (src) => ({ id: "f", type: "select", meta: { optionsSource: src } });

describe("manual options", () => {
  it("reads the editor's `values`", () => {
    expect(resolveOptions(field({ mode: "manual", values: ["a", "b"] }), {}).options.map((o) => o.value)).toEqual(["a", "b"]);
  });
  it("reads a seeded field's `options` too", () => {
    expect(resolveOptions(field({ mode: "manual", options: ["weekly", "monthly"] }), {}).options.map((o) => o.label)).toEqual(["weekly", "monthly"]);
  });
  it("prefers `values` when both are present", () => {
    expect(manualValues({ values: ["x"], options: ["y"] })).toEqual(["x"]);
    expect(manualValues({})).toEqual([]);
  });
});
