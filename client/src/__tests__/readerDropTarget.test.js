import { describe, it, expect } from "vitest";
import { panelPointToPage, slotAt } from "../helpers/readerDropTarget.js";

describe("readerDropTarget", () => {
  it("maps a panel point below the toolbar into the page", () => {
    // 1.6m x 1.0m panel, page 800px wide => 500 px/m; panel is 500px tall, page 450 => 50px toolbar.
    const p = panelPointToPage({ u: 0.5, v: 0.5, wM: 1.6, hM: 1.0, innerWidth: 800, innerHeight: 450 });
    expect(p.x).toBe(400);
    expect(p.y).toBe(200);
  });
  it("a point on the toolbar is above the page", () => {
    expect(panelPointToPage({ u: 0, v: 0.05, wM: 1.6, hM: 1, innerWidth: 800, innerHeight: 450 }).y).toBeLessThan(0);
  });
  it("finds the slot by row middles", () => {
    const rows = [{ top: 0, height: 20 }, { top: 20, height: 20 }, { top: 40, height: 20 }];
    expect(slotAt(rows, 5)).toBe(0);
    expect(slotAt(rows, 15)).toBe(1);
    expect(slotAt(rows, 55)).toBe(3);
  });
});
