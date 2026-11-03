import { describe, it, expect } from "vitest";
import { phoneCells } from "../helpers/phoneCells.js";

const P = (id, row, col, width = 1, height = 1, extra = {}) => ({ _occurrenceId: id, row, col, width, height, ...extra });
const at = (res, id) => { const p = res.panels.find((x) => x._occurrenceId === id); return p && [p.row, p.col, p.width, p.height]; };

describe("phoneCells", () => {
  it("keeps placements that are in bounds and free", () => {
    const r = phoneCells([P("a", 0, 0), P("c", 0, 1, 1, 2)], 2, 2);
    expect(at(r, "a")).toEqual([0, 0, 1, 1]);
    expect(at(r, "c")).toEqual([0, 1, 1, 2]);
    expect(r.rows).toBe(2);
  });
  it("poms grid: panels dropped on taken cells get free cells instead of stacking", () => {
    const r = phoneCells([P("b5a", 0, 1), P("b5b", 0, 0), P("A", 0, 0), P("C", 0, 1, 1, 2)], 2, 2);
    const cells = r.panels.flatMap((p) => { const out = []; for (let y = p.row; y < p.row + p.height; y++) for (let x = p.col; x < p.col + p.width; x++) out.push(`${y}:${x}`); return out; });
    expect(new Set(cells).size).toBe(cells.length); // no two panels share a cell
    expect(r.panels).toHaveLength(4);
  });
  it("adds rows when the grid is full", () => {
    const r = phoneCells([P("a", 0, 0), P("b", 0, 0), P("c", 0, 0)], 1, 2);
    expect(r.rows).toBe(2);
    expect(at(r, "c")).toEqual([1, 0, 1, 1]);
  });
  it("a placement outside the grid moves inside", () => {
    const r = phoneCells([P("a", 5, 7)], 2, 2);
    expect(at(r, "a")).toEqual([0, 0, 1, 1]);
  });
  it("a panel hidden as the back of a desktop stack is shown when it has its own cell", () => {
    const r = phoneCells([P("a", 0, 0), P("b", 0, 0, 1, 1, { layout: { style: { display: "none" } } })], 1, 2);
    expect(r.panels.find((p) => p._occurrenceId === "b").layout.style.display).toBe("block");
  });
  it("does not modify its input", () => {
    const input = [P("a", 0, 0), P("b", 0, 0)];
    const copy = JSON.stringify(input);
    phoneCells(input, 1, 1);
    expect(JSON.stringify(input)).toBe(copy);
  });
});
