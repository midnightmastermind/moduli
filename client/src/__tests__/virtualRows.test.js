// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { planRows, rangeWithPin, findScrollParent } from "../helpers/virtualRows";
import fs from "node:fs";
import path from "node:path";

const vi = (index, start, end) => ({ index, key: `k${index}`, start, end });

describe("planRows", () => {
  it("puts a spacer above, the rows, and a spacer below", () => {
    expect(planRows([vi(10, 500, 550), vi(11, 550, 600)], 2000)).toEqual([
      { spacer: 500 }, { index: 10, key: "k10" }, { index: 11, key: "k11" }, { spacer: 1400 },
    ]);
  });
  it("a pinned row away from the range gets a spacer on each side", () => {
    const plan = planRows([vi(0, 0, 50), vi(1, 50, 100), vi(600, 30000, 30050)], 50000);
    expect(plan).toEqual([
      { index: 0, key: "k0" }, { index: 1, key: "k1" },
      { spacer: 29900 }, { index: 600, key: "k600" }, { spacer: 19950 },
    ]);
  });
  it("CONTROL: the spacers and rows add up to the full length", () => {
    const items = [vi(3, 150, 210), vi(4, 210, 250)];
    const total = 1000;
    const sum = planRows(items, total).reduce((s, p) => s + (p.spacer ?? 0), 0) + (210 - 150) + (250 - 210);
    expect(sum).toBe(total);
  });
  it("no spacer when there is no gap", () => {
    expect(planRows([vi(0, 0, 40)], 40)).toEqual([{ index: 0, key: "k0" }]);
  });
});

describe("rangeWithPin", () => {
  const range = { startIndex: 10, endIndex: 12, overscan: 1, count: 1000 };
  it("adds the pinned index to the range, sorted", () => {
    expect(rangeWithPin(range, 600)).toEqual([9, 10, 11, 12, 13, 600]);
    expect(rangeWithPin(range, 2)).toEqual([2, 9, 10, 11, 12, 13]);
  });
  it("leaves the range alone without a pin, or with one already inside it", () => {
    expect(rangeWithPin(range, null)).toEqual([9, 10, 11, 12, 13]);
    expect(rangeWithPin(range, 11)).toEqual([9, 10, 11, 12, 13]);
  });
  it("ignores a pin past the end of the list", () => {
    expect(rangeWithPin(range, 5000)).toEqual([9, 10, 11, 12, 13]);
  });
});

describe("findScrollParent", () => {
  it("finds the nearest scrolling ancestor by its computed style", () => {
    const outer = document.createElement("div"); outer.style.overflowY = "auto";
    const mid = document.createElement("div"); mid.style.overflowY = "visible";
    const list = document.createElement("div");
    outer.appendChild(mid); mid.appendChild(list); document.body.appendChild(outer);
    expect(findScrollParent(list)).toBe(outer);
    outer.remove();
  });
  it("returns null when nothing scrolls", () => {
    const list = document.createElement("div"); document.body.appendChild(list);
    expect(findScrollParent(list)).toBe(null);
    list.remove();
  });
});

describe("wiring", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../modules/ModuleContainer.jsx"), "utf8");
  it("ModuleContainer virtualizes long stacks and disables the render window for them", () => {
    expect(src).toMatch(/useVirtualRows\(\{/);
    expect(src).toMatch(/useRenderWindow\([^)]*enabled:\s*!virtualEligible/);
    expect(src).toMatch(/ref=\{itemsListRef\}/);
  });
  it("only STACK layouts are eligible (row / wrap / tile CSS needs direct children)", () => {
    expect(src).toMatch(/virtualEligible\s*=\s*!childLayout\.className\s*&&\s*childContentDir !== "column"/);
  });
});
