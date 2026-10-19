// The virtual grid re-measured every line after every render and resized it even when the height
// had moved by a fraction of a pixel; each resize re-rendered, so the chain never settled and a
// Bookmarks board crashed its panel (React #185) during a search jump.
import { describe, it, expect } from "vitest";
import { lineNeedsResize, takeMeasurePass, GRID_MEASURES_PER_BURST } from "../helpers/virtualRows.js";

describe("virtual grid line measuring settles", () => {
  it("ignores sub-pixel wobble and resizes real changes", () => {
    expect(lineNeedsResize(240, 240.4)).toBe(false);
    expect(lineNeedsResize(240, 239.2)).toBe(false);
    expect(lineNeedsResize(240, 252)).toBe(true);
    expect(lineNeedsResize(undefined, 252)).toBe(true);
    expect(lineNeedsResize(240, 0)).toBe(false);
  });
  it("caps back-to-back passes and resets after a pause", () => {
    const b = { at: 0, n: 0 };
    let ok = 0;
    for (let i = 0; i < 40; i++) if (takeMeasurePass(b, 1000 + i)) ok += 1;
    expect(ok).toBe(GRID_MEASURES_PER_BURST);
    expect(takeMeasurePass(b, 1200)).toBe(true);
  });
});

describe("childrenById", () => {
  it("maps the list's direct children by occurrence id, first one winning", async () => {
    const { childrenById } = await import("../helpers/virtualRows");
    const mk = (id) => ({ getAttribute: (k) => (k === "data-occurrence-id" ? id : null) });
    const a = mk("a"), b = mk("b"), a2 = mk("a"), spacer = mk(null);
    const m = childrenById({ children: [a, spacer, b, a2] });
    expect(m.get("a")).toBe(a);
    expect(m.get("b")).toBe(b);
    expect(m.size).toBe(2);
    expect(childrenById(null).size).toBe(0);
  });
});
