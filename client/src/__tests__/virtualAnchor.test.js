// @vitest-environment jsdom
// A phone turned sideways, and a list settling under a still finger (user, 2026-11-02: boards "would go
// to the very end of a list if i changed from portrait to landscape").
import { describe, it, expect } from "vitest";
import { estimateFor, topTileFromDom, anchorElement } from "../helpers/virtualRows.js";

describe("estimateFor", () => {
  it("a row above the rendered range keeps its first estimate while the average moves", () => {
    const frozen = new Map();
    expect(estimateFor(3, 100, frozen, 10)).toBe(100);
    expect(estimateFor(3, 400, frozen, 10)).toBe(100);
  });
  it("a row at or below the range follows the average", () => {
    const frozen = new Map();
    expect(estimateFor(12, 100, frozen, 10)).toBe(100);
    expect(estimateFor(12, 400, frozen, 10)).toBe(400);
    expect(frozen.size).toBe(0);
  });
  it("with no range yet nothing is frozen", () => {
    const frozen = new Map();
    estimateFor(0, 50, frozen, undefined);
    expect(frozen.size).toBe(0);
  });
});

function rect(top, height) { return () => ({ top, bottom: top + height, height, left: 0, right: 100, width: 100 }); }
function makeList(rows, { kind = "row" } = {}) {
  const list = document.createElement("div");
  for (const r of rows) {
    const el = document.createElement("div");
    if (r.spacer) el.className = "virtual-spacer";
    else if (kind === "row") { el.className = "virtual-row"; el.dataset.index = String(r.i); }
    else el.setAttribute("data-occurrence-id", r.id);
    el.getBoundingClientRect = rect(r.top, r.h);
    list.appendChild(el);
  }
  return list;
}
const scroller = { getBoundingClientRect: rect(100, 600) };

describe("topTileFromDom", () => {
  it("is the row covering the top of the scroller", () => {
    const list = makeList([{ spacer: true, top: -900, h: 900 }, { i: 7, top: 20, h: 60 }, { i: 8, top: 80, h: 300 }, { i: 9, top: 380, h: 300 }]);
    expect(topTileFromDom(list, scroller, 1, null)).toBe(8);
  });
  it("a top that is still spacer is not a reading (null without an estimate)", () => {
    const list = makeList([{ spacer: true, top: -900, h: 1200 }, { i: 30, top: 300, h: 200 }]);
    expect(topTileFromDom(list, scroller, 1, null)).toBe(null);
  });
  it("a grid tile is found by its occurrence id", () => {
    const list = makeList([{ id: "a", top: 0, h: 90 }, { id: "b", top: 90, h: 200 }], { kind: "tile" });
    expect(topTileFromDom(list, scroller, 4, (id) => ({ a: 40, b: 44 })[id])).toBe(44);
  });
});

describe("anchorElement", () => {
  it("finds a stacked row by its index and a grid line by its first tile", () => {
    const rows = makeList([{ i: 4, top: 0, h: 10 }, { i: 5, top: 10, h: 10 }]);
    expect(anchorElement(rows, 5, 1).dataset.index).toBe("5");
    const tiles = makeList([{ id: "x", top: 0, h: 10 }, { id: "y", top: 0, h: 10 }], { kind: "tile" });
    expect(anchorElement(tiles, 2, 3, (i) => (i === 6 ? "y" : null)).getAttribute("data-occurrence-id")).toBe("y");
  });
});
