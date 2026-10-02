import { describe, it, expect } from "vitest";
import { SNAP_LAYOUTS, opensSnapLayouts, zoneAt, snapLeafToRegion, regionOf, paneFraction } from "../helpers/mosaicSnap";
import { makeLeaf, makeSplit } from "../helpers/bspTree";

// Three panels, the shape of a real grid: A | (B over C).
const tree = () => makeSplit("v", [makeLeaf("A"), makeSplit("h", [makeLeaf("B"), makeLeaf("C")])]);

describe("snap layouts", () => {
  it("every half/quadrant zone's picture is the region it names", () => {
    for (const l of SNAP_LAYOUTS) for (const z of l.zones) {
      if (z.region.span) continue;   // columns: pinned by the landing test below
      const { col, row } = z.region;
      expect(z.x).toBe(col === "right" ? 0.5 : 0);
      expect(z.w).toBe(col === "full" ? 1 : 0.5);
      expect(z.y).toBe(row === "bottom" ? 0.5 : 0);
      expect(z.h).toBe(row === "full" ? 1 : 0.5);
    }
  });

  it("each layout's zones tile the grid exactly once", () => {
    for (const l of SNAP_LAYOUTS) {
      const area = l.zones.reduce((a, z) => a + z.w * z.h, 0);
      expect(area).toBeCloseTo(1);
    }
  });

  it("dropping a panel on a zone puts it in that region", () => {
    // Every zone of every layout, applied to a panel that is not already there.
    let applied = 0;
    for (const l of SNAP_LAYOUTS) for (const z of l.zones) {
      if (z.region.span) continue;   // a column span has no regionOf name
      const next = snapLeafToRegion(tree(), "B", z.region);
      if (!next) continue;   // already there / the documented degrade
      applied++;
      expect(regionOf(next, "B")).toEqual(z.region);
    }
    // A loop that skipped every zone would pass this vacuously.
    expect(applied).toBeGreaterThanOrEqual(12);
  });

  it("only the top edge's middle opens the bar; corners and other sides do not", () => {
    const w = 1200, h = 800;
    expect(opensSnapLayouts(zoneAt({ x: 600, y: 10, w, h }))).toBe(true);
    expect(opensSnapLayouts(zoneAt({ x: 50, y: 10, w, h }))).toBe(false);    // top-left corner
    expect(opensSnapLayouts(zoneAt({ x: 10, y: 400, w, h }))).toBe(false);   // left side
    expect(opensSnapLayouts(zoneAt({ x: 600, y: 795, w, h }))).toBe(false);  // bottom
    expect(opensSnapLayouts(zoneAt({ x: 600, y: 400, w, h }))).toBe(false);  // interior
  });

  it("offers thirds", () => {
    const ids = SNAP_LAYOUTS.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(["thirds", "two-thirds-left", "two-thirds-right"]));
  });

  it("a panel dropped on ANY zone lands exactly where that zone is drawn", () => {
    let landed = 0;
    for (const l of SNAP_LAYOUTS) for (const z of l.zones) {
      const next = snapLeafToRegion(tree(), "B", z.region);
      if (!next) continue;
      landed++;
      const f = paneFraction(next, "B");
      expect(f.x).toBeCloseTo(z.x); expect(f.y).toBeCloseTo(z.y);
      expect(f.w).toBeCloseTo(z.w); expect(f.h).toBeCloseTo(z.h);
    }
    expect(landed).toBeGreaterThanOrEqual(18);
  });

  it("thirds: the other columns stay columns and share what is left", () => {
    const next = snapLeafToRegion(tree(), "B", { col: "middle", row: "full", span: 1 / 3 });
    for (const id of ["A", "B", "C"]) {
      const f = paneFraction(next, id);
      expect(f.w).toBeCloseTo(1 / 3); expect(f.h).toBeCloseTo(1);
    }
    expect(paneFraction(next, "B").x).toBeCloseTo(1 / 3);
  });

  it("the middle third needs a column on each side, and a repeat drop changes nothing", () => {
    const two = makeSplit("v", [makeLeaf("A"), makeLeaf("B")]);
    expect(snapLeafToRegion(two, "B", { col: "middle", row: "full", span: 1 / 3 })).toBeNull();
    const once = snapLeafToRegion(tree(), "B", { col: "left", row: "full", span: 1 / 3 });
    expect(snapLeafToRegion(once, "B", { col: "left", row: "full", span: 1 / 3 })).toBeNull();
  });
});

import { planSnapLayout, treeFromZones, fillNewPanels, NEW_PANEL } from "../helpers/mosaicSnap";
import { allPanelOccIds } from "../helpers/bspTree";

const L = (id) => SNAP_LAYOUTS.find((l) => l.id === id);

describe("a layout pick applies the whole layout", () => {
  it("every layout builds a tree that puts each zone exactly where it is drawn", () => {
    for (const l of SNAP_LAYOUTS) {
      const ids = l.zones.map((_, i) => `p${i}`);
      const t = treeFromZones(l.zones, ids);
      l.zones.forEach((z, i) => {
        const f = paneFraction(t, ids[i]);
        expect(f.x).toBeCloseTo(z.x); expect(f.y).toBeCloseTo(z.y);
        expect(f.w).toBeCloseTo(z.w); expect(f.h).toBeCloseTo(z.h);
      });
    }
  });

  it("3 panels into a 4-zone layout adds one panel", () => {
    const plan = planSnapLayout(tree(), "B", L("quadrants"), 0);
    expect(plan.addCount).toBe(1);
    expect(plan.removeIds).toEqual([]);
    const ids = allPanelOccIds(plan.tree);
    expect(ids).toEqual(expect.arrayContaining(["A", "B", "C", NEW_PANEL(0)]));
    expect(paneFraction(plan.tree, "B")).toMatchObject({ x: 0, y: 0 });
    const filled = fillNewPanels(plan.tree, ["NEWID"]);
    expect(allPanelOccIds(filled)).toContain("NEWID");
    expect(allPanelOccIds(filled)).not.toContain(NEW_PANEL(0));
  });

  it("3 panels into a 2-zone layout removes the last one in reading order", () => {
    const plan = planSnapLayout(tree(), "C", L("halves-v"), 1);
    expect(plan.addCount).toBe(0);
    expect(plan.removeIds).toEqual(["B"]);   // A is first (left column), B next (top right)
    expect(allPanelOccIds(plan.tree).sort()).toEqual(["A", "C"]);
    expect(paneFraction(plan.tree, "C").x).toBeCloseTo(0.5);
  });

  it("the others keep their reading order, and a no-op pick returns null", () => {
    const plan = planSnapLayout(tree(), "A", L("thirds"), 2);
    expect(paneFraction(plan.tree, "B").x).toBeCloseTo(0);
    expect(paneFraction(plan.tree, "C").x).toBeCloseTo(1 / 3);
    expect(planSnapLayout(plan.tree, "A", L("thirds"), 2)).toBeNull();
  });
});
