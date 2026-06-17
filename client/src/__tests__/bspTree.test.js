import { describe, it, expect } from "vitest";
import {
  isLeaf, makeLeaf, makeSplit,
  deriveTreeFromPlacements, computeLayout,
  resizeSplit, splitLeaf, removeLeaf,
  allPanelOccIds, findLeaf,
} from "../helpers/bspTree";

// Seed-like placements: 3 columns. col0 = toolkit/todos stacked, col1 = a
// single full-height hub, col2 = goals/accounts stacked.
const seedPanels = [
  { _occurrenceId: "toolkit", row: 0, col: 0 },
  { _occurrenceId: "todos", row: 1, col: 0 },
  { _occurrenceId: "hub", row: 0, col: 1 },
  { _occurrenceId: "goals", row: 0, col: 2 },
  { _occurrenceId: "accounts", row: 1, col: 2 },
];

describe("deriveTreeFromPlacements", () => {
  it("builds a column-major v-split with stacked columns", () => {
    const t = deriveTreeFromPlacements(seedPanels);
    expect(t.dir).toBe("v");
    expect(t.children).toHaveLength(3);
    // col0 = h-split (toolkit over todos)
    expect(t.children[0].dir).toBe("h");
    expect(allPanelOccIds(t.children[0])).toEqual(["toolkit", "todos"]);
    // col1 = bare leaf (single full-height pane)
    expect(isLeaf(t.children[1])).toBe(true);
    expect(t.children[1].panelOccId).toBe("hub");
    // col2 = h-split (goals over accounts)
    expect(allPanelOccIds(t.children[2])).toEqual(["goals", "accounts"]);
  });

  it("returns a bare leaf for a single panel", () => {
    const t = deriveTreeFromPlacements([{ _occurrenceId: "solo", row: 0, col: 0 }]);
    expect(isLeaf(t)).toBe(true);
    expect(t.panelOccId).toBe("solo");
  });

  it("ignores hidden panels and de-dups a stacked cell to the first visible", () => {
    const panels = [
      { _occurrenceId: "vis", row: 0, col: 0 },
      { _occurrenceId: "stacked", row: 0, col: 0 }, // same cell → dropped
      { _occurrenceId: "hidden", row: 1, col: 0, layout: { style: { display: "none" } } },
    ];
    expect(allPanelOccIds(deriveTreeFromPlacements(panels))).toEqual(["vis"]);
  });

  it("returns null when there are no visible panels", () => {
    expect(deriveTreeFromPlacements([])).toBeNull();
  });
});

describe("computeLayout", () => {
  const rect = { x: 0, y: 0, w: 300, h: 200 };

  it("a single leaf fills the whole rect, no splitters", () => {
    const { panes, splitters } = computeLayout(makeLeaf("p"), rect);
    expect(panes).toHaveLength(1);
    expect(panes[0].rect).toEqual(rect);
    expect(splitters).toHaveLength(0);
  });

  it("panes tile the bounds exactly (areas sum, no overlap) + one splitter per divider", () => {
    const t = deriveTreeFromPlacements(seedPanels);
    const { panes, splitters } = computeLayout(t, rect);
    expect(panes).toHaveLength(5);
    const area = panes.reduce((a, p) => a + p.rect.w * p.rect.h, 0);
    expect(area).toBeCloseTo(rect.w * rect.h, 5);
    // 2 column dividers + 1 in col0 + 1 in col2 = 4 splitters
    expect(splitters).toHaveLength(4);
    // every pane within bounds
    for (const p of panes) {
      expect(p.rect.x).toBeGreaterThanOrEqual(-0.001);
      expect(p.rect.y).toBeGreaterThanOrEqual(-0.001);
      expect(p.rect.x + p.rect.w).toBeLessThanOrEqual(rect.w + 0.001);
      expect(p.rect.y + p.rect.h).toBeLessThanOrEqual(rect.h + 0.001);
    }
  });

  it("equal ratios split evenly; v-split divides X, h-split divides Y", () => {
    const v = makeSplit("v", [makeLeaf("a"), makeLeaf("b")]);
    const { panes } = computeLayout(v, rect);
    expect(panes[0].rect.w).toBeCloseTo(150);
    expect(panes[1].rect.x).toBeCloseTo(150);
    const h = makeSplit("h", [makeLeaf("a"), makeLeaf("b")]);
    const out = computeLayout(h, rect);
    expect(out.panes[0].rect.h).toBeCloseTo(100);
    expect(out.panes[1].rect.y).toBeCloseTo(100);
  });
});

describe("resizeSplit", () => {
  it("shifts fr between a pair and conserves their sum", () => {
    const t = makeSplit("v", [makeLeaf("a"), makeLeaf("b")], [1, 1], "s1");
    const r = resizeSplit(t, "s1", 0, 0.4);
    expect(r.ratio[0]).toBeCloseTo(1.4);
    expect(r.ratio[1]).toBeCloseTo(0.6);
    expect(r.ratio[0] + r.ratio[1]).toBeCloseTo(2);
    expect(t.ratio).toEqual([1, 1]); // immutable
  });

  it("clamps to MIN_RATIO without changing the pair sum", () => {
    const t = makeSplit("v", [makeLeaf("a"), makeLeaf("b")], [1, 1], "s1");
    const r = resizeSplit(t, "s1", 0, 5); // would push b far negative
    expect(r.ratio[0] + r.ratio[1]).toBeCloseTo(2);
    expect(r.ratio[1]).toBeCloseTo(0.05);
  });

  it("resizes a nested split by id", () => {
    const inner = makeSplit("h", [makeLeaf("a"), makeLeaf("b")], [1, 1], "inner");
    const t = makeSplit("v", [inner, makeLeaf("c")], [1, 1], "outer");
    const r = resizeSplit(t, "inner", 0, 0.5);
    expect(r.children[0].ratio).toEqual([1.5, 0.5]);
    expect(r.id).toBe("outer");
  });
});

describe("splitLeaf", () => {
  it("wraps a leaf when splitting perpendicular to its parent", () => {
    const t = makeSplit("v", [makeLeaf("a", "la"), makeLeaf("b", "lb")], [1, 1], "s");
    const r = splitLeaf(t, "la", "h", "new");
    expect(r.children[0].dir).toBe("h"); // a got wrapped
    expect(allPanelOccIds(r.children[0])).toEqual(["a", "new"]);
  });

  it("flattens (inserts a sibling) when splitting along the parent's dir", () => {
    const t = makeSplit("v", [makeLeaf("a", "la"), makeLeaf("b", "lb")], [2, 2], "s");
    const r = splitLeaf(t, "la", "v", "new");
    expect(r.children).toHaveLength(3);
    expect(allPanelOccIds(r)).toEqual(["a", "new", "b"]);
    expect(r.ratio[0] + r.ratio[1]).toBeCloseTo(2); // split a's weight
  });

  it("wraps a top-level bare leaf into a split", () => {
    const r = splitLeaf(makeLeaf("a", "la"), "la", "h", "new", true);
    expect(r.dir).toBe("h");
    expect(allPanelOccIds(r)).toEqual(["new", "a"]);
  });
});

describe("removeLeaf", () => {
  it("collapses a single-child split when a sibling is removed", () => {
    const t = makeSplit("h", [makeLeaf("a"), makeLeaf("b")], [1, 1], "s");
    const r = removeLeaf(t, "a");
    expect(isLeaf(r)).toBe(true);
    expect(r.panelOccId).toBe("b");
  });

  it("removes a pane and keeps the rest of the tree", () => {
    const t = deriveTreeFromPlacements(seedPanels);
    const r = removeLeaf(t, "todos");
    expect(allPanelOccIds(r).sort()).toEqual(["accounts", "goals", "hub", "toolkit"]);
    // col0 collapsed to just toolkit (bare leaf)
    expect(isLeaf(r.children[0])).toBe(true);
    expect(r.children[0].panelOccId).toBe("toolkit");
  });

  it("returns null when the last pane is removed", () => {
    expect(removeLeaf(makeLeaf("solo"), "solo")).toBeNull();
  });
});

describe("findLeaf / allPanelOccIds", () => {
  it("finds a leaf by panelOccId", () => {
    const t = deriveTreeFromPlacements(seedPanels);
    expect(findLeaf(t, "hub").panelOccId).toBe("hub");
    expect(findLeaf(t, "nope")).toBeNull();
  });
});
