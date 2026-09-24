// helpers/bspTree.treeToCells — the phone's cell map comes from the desktop's
// split tree, not from stale `occurrence.placement`s (poms grid, 2026-09-24).
import { describe, it, expect } from "vitest";
import { treeToCells } from "../helpers/bspTree";

const leaf = (id) => ({ id: `leaf-${id}`, panelOccId: id });
const split = (dir, children, ratio = children.map(() => 1)) => ({ id: `s-${dir}-${children.length}`, dir, children, ratio });

describe("treeToCells", () => {
  it("poms grid: A over C on the left, D full-height on the RIGHT", () => {
    // The live tree. Its stale placements said C right / D below A.
    const tree = split("v", [split("h", [leaf("A"), leaf("C")]), leaf("D")]);
    const { rows, cols, cells } = treeToCells(tree);
    expect([rows, cols]).toEqual([2, 2]);
    expect(cells.A).toEqual({ row: 0, col: 0, width: 1, height: 1 });
    expect(cells.C).toEqual({ row: 1, col: 0, width: 1, height: 1 });
    expect(cells.D).toEqual({ row: 0, col: 1, width: 1, height: 2 });   // RIGHT, not below
  });

  it("uneven ratios still produce whole cells", () => {
    const tree = split("v", [leaf("L"), split("h", [leaf("T"), leaf("B")], [1, 3])], [0.8, 1]);
    const { rows, cols, cells } = treeToCells(tree);
    expect([rows, cols]).toEqual([2, 2]);
    expect(cells.L).toEqual({ row: 0, col: 0, width: 1, height: 2 });
    expect(cells.B).toEqual({ row: 1, col: 1, width: 1, height: 1 });
  });

  it("a single panel is 1×1; no tree is empty", () => {
    expect(treeToCells(leaf("X"))).toEqual({ rows: 1, cols: 1, cells: { X: { row: 0, col: 0, width: 1, height: 1 } } });
    expect(treeToCells(null)).toEqual({ rows: 1, cols: 1, cells: {} });
  });

  it("the mobile nav reads the tree, not placements (wiring)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "../Grid.jsx"), "utf8");
    const body = src.slice(src.indexOf("function MosaicMobileNav"), src.indexOf("function MosaicMobileNav") + 8000);
    expect(body).toMatch(/treeToCells\(layoutTree\)/);
  });
});
