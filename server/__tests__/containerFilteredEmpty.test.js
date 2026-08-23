// The `container-filtered-empty` rule. Written against a defect that shipped:
// 1,467 bookmarks whose save-date landed in the grid's FILTER field, so the
// board drew empty every day while every data check said it was fine.
import { describe, it, expect } from "vitest";
import { checkGridIntegrity } from "../utils/gridIntegrity.js";

const D = "fDate";
const grid = { activeFilterValues: { [D]: "2026-08-23" } };
const dated = (id, v, kids = []) => ({ id, moduleId: "m", occurrences: kids, fields: v ? { [D]: { value: v } } : {} });
const mods = [{ id: "m", label: "Box", role: "container", kind: "board" }];
const codes = (occurrences, g = grid) =>
  checkGridIntegrity({ grid: g, occurrences, modules: mods }).map(f => f.code);

describe("container-filtered-empty", () => {
  it("FIRES when a visible container's every child is filtered out", () => {
    const occ = [dated("box", null, ["a","b","c"]), dated("a","2021-01-01"), dated("b","2021-01-02"), dated("c","2021-01-03")];
    expect(codes(occ)).toContain("container-filtered-empty");
  });

  it("stays quiet when even ONE child shows", () => {
    const occ = [dated("box", null, ["a","b","c"]), dated("a","2021-01-01"), dated("b","2026-08-23"), dated("c","2021-01-03")];
    expect(codes(occ)).not.toContain("container-filtered-empty");
  });

  it("stays quiet when the CONTAINER is hidden too — an old day column", () => {
    // The rule that keeps this from crying wolf: every grid accumulates past
    // day columns whose children are all hidden, and nobody is looking at them.
    const occ = [dated("box", "2026-07-01", ["a","b","c"]), dated("a","2026-07-01"), dated("b","2026-07-01"), dated("c","2026-07-01")];
    expect(codes(occ)).not.toContain("container-filtered-empty");
  });

  it("stays quiet for a child carrying NO value — absent is not hidden", () => {
    // The schedule's slots carry no date and render on every day; treating
    // absent as hidden would flag the whole Schedule.
    const occ = [dated("box", null, ["a","b","c"]), dated("a", null), dated("b", null), dated("c", null)];
    expect(codes(occ)).not.toContain("container-filtered-empty");
  });

  it("stays quiet under the three-child floor", () => {
    // One or two dated rows is an ordinary day's work.
    const occ = [dated("box", null, ["a","b"]), dated("a","2021-01-01"), dated("b","2021-01-02")];
    expect(codes(occ)).not.toContain("container-filtered-empty");
  });

  it("stays quiet when the grid filters on NOTHING", () => {
    const occ = [dated("box", null, ["a","b","c"]), dated("a","2021-01-01"), dated("b","2021-01-02"), dated("c","2021-01-03")];
    expect(codes(occ, { activeFilterValues: {} })).not.toContain("container-filtered-empty");
    expect(codes(occ, {})).not.toContain("container-filtered-empty");
  });

  it("ignores a child id that resolves to nothing", () => {
    // A dangling ref is its own rule; it must not be counted as a hidden child
    // and turn this into a second report of the same thing.
    const occ = [dated("box", null, ["a","gone","b"]), dated("a","2026-08-23"), dated("b","2026-08-23")];
    expect(codes(occ)).not.toContain("container-filtered-empty");
  });
});
