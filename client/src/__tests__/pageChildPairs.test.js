// A board page pairs each child with ITS placement. It resolved one placement per child MODULE — the first visible
// placement of that module — so a page holding two placements of one container (a copy-mode drag, or a template
// applied twice) rendered the first placement twice and the second was unreachable (2026-10-09).
import { describe, it, expect } from "vitest";
import { pairPageChildren } from "../helpers/pageChildPairs.js";

const mods = { mA: { id: "mA", label: "Slot" }, mB: { id: "mB", label: "Other" } };
const all = () => true;

describe("pairPageChildren", () => {
  it("two placements of one module, both visible, give two pairs with their own placements", () => {
    const occs = { o1: { id: "o1", moduleId: "mA" }, o2: { id: "o2", moduleId: "mA" } };
    const pairs = pairPageChildren(["o1", "o2"], occs, mods, all);
    expect(pairs.map((p) => p.occurrence.id)).toEqual(["o1", "o2"]);
    expect(pairs.every((p) => p.container === mods.mA)).toBe(true);
  });

  it("control: per-day placements of one module show only the visible one, once", () => {
    const occs = { d1: { id: "d1", moduleId: "mA", day: 1 }, d2: { id: "d2", moduleId: "mA", day: 2 }, b: { id: "b", moduleId: "mB" } };
    const visible = (o) => o.day === undefined || o.day === 2;
    expect(pairPageChildren(["d1", "d2", "b"], occs, mods, visible).map((p) => p.occurrence.id)).toEqual(["d2", "b"]);
  });

  it("keeps page order and skips missing occurrences or modules", () => {
    const occs = { x: { id: "x", moduleId: "mB" }, y: { id: "y", moduleId: "gone" }, z: { id: "z", moduleId: "mA" } };
    expect(pairPageChildren(["x", "missing", "y", "z"], occs, mods, all).map((p) => p.occurrence.id)).toEqual(["x", "z"]);
  });
});

describe("ModulePage pairs its children by placement", () => {
  const src = require("fs").readFileSync(require("path").resolve(__dirname, "../modules/ModulePage.jsx"), "utf8");
  it("containersList is built with pairPageChildren", () => { expect(src).toMatch(/pairPageChildren\(occurrence\.occurrences/); });
  it("and no longer resolves one placement per child module", () => { expect(src).not.toMatch(/for \(const container of childModules\)/); });
});
