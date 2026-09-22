// A CELL ALWAYS SHOWS ONE PANEL.
//
// `cyclePanelStack` cycled N+1 states — each panel, then "all hidden" — and
// `Grid` rendered a cell-level Layers button so you could cycle back out of the
// empty state. But Grid ALSO carries a "Defensive: ensure at least one panel
// per cell is visible" effect that force-writes `display: "block"` on the first
// panel the moment a cell goes all-hidden.
//
// Measured on prod 2026-09-22 with two panels stacked in one cell, sampling the
// modules after each press:
//
//   start   A none   B block
//   press   A block  B none      <- expected "all hidden" by the cycler's math
//   press   A none   B block
//   press   A block  B none
//
// A pure A/B toggle: the hidden state never appeared, because the defensive
// effect undid it — and the prediction that it WOULD appear is what identified
// the effect as the cause rather than a guess. So the hidden state was
// unreachable, the cell-level button was dead code, and every attempt cost a
// wasted `update_module` write as the two rules fought.
//
// The user chose "always keep one visible" (2026-09-22), so the cycle is N
// states and the defensive effect is the only authority on the invariant.
import { describe, it, expect } from "vitest";
import { nextStackIndex } from "../helpers/panelStack";

describe("nextStackIndex", () => {
  it("cycles through the panels and wraps — never to an all-hidden state", () => {
    const seen = [];
    let idx = 0;
    for (let i = 0; i < 6; i++) { idx = nextStackIndex(idx, 3, 1); seen.push(idx); }
    expect(seen).toEqual([1, 2, 0, 1, 2, 0]);
    // The load-bearing assertion: every state names a real panel. `stack.length`
    // was the old "hidden" sentinel, so it must never be returned.
    expect(seen.every((i) => i >= 0 && i < 3)).toBe(true);
  });

  it("goes backwards too", () => {
    expect(nextStackIndex(0, 3, -1)).toBe(2);
    expect(nextStackIndex(2, 3, -1)).toBe(1);
  });

  it("a single panel is not a stack — cycling it would hide the only thing in the cell", () => {
    expect(nextStackIndex(0, 1, 1)).toBeNull();
    expect(nextStackIndex(-1, 1, 1)).toBeNull();
  });

  it("recovers when nothing is visible yet (a cell mid-heal)", () => {
    // Forward from "before the first", backward from "the last".
    expect(nextStackIndex(-1, 3, 1)).toBe(0);
    expect(nextStackIndex(-1, 3, -1)).toBe(2);
  });

  it("an out-of-range index is treated as nothing visible, not as a crash", () => {
    expect(nextStackIndex(99, 3, 1)).toBe(0);
  });

  it("no panels: nothing to do", () => {
    expect(nextStackIndex(0, 0, 1)).toBeNull();
    expect(nextStackIndex(0, undefined, 1)).toBeNull();
  });
});

describe("the two rules no longer contradict", () => {
  it("Grid still owns the invariant — the defensive effect is intact", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = (await import("node:path")).default;
    const here = path.dirname(fileURLToPath(import.meta.url));
    const grid = readFileSync(path.join(here, "..", "Grid.jsx"), "utf8");
    // The chosen winner. If someone removes this, the cycle must gain its
    // hidden state back deliberately — not by accident.
    expect(grid).toContain("Ensure at least one panel per cell is visible");
    // And the dead empty-pocket cycler that only existed for that state is gone,
    // along with the prop computed solely to feed it.
    expect(grid, "the dead empty-cell cycler button is back").not.toContain("cyclePanelStack");
    expect(grid, "hasHiddenStack was only ever read by that button").not.toContain("hasHiddenStack");
  });

  it("the cycler is wired to the helper (the wiring is where this bug lived)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = (await import("node:path")).default;
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, "..", "helpers", "DragProvider.jsx"), "utf8");
    const fn = src.slice(src.indexOf("const cyclePanelStack"));
    // CONTROL — the cycler still exists and still writes display, or the two
    // "no longer contains" assertions below would pass against a deleted feature.
    expect(fn).toContain("display:");
    expect(fn).toContain("nextStackIndex(");
    expect(fn, "the +1 hidden state is back").not.toContain("stack.length + 1");
  });
});
