// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { nearestDocBoundary } from "../ui/Editor.jsx";

// Three 24px lines with no space between them, in a wrapper with 8px padding top and bottom.
function setup(lines = [[108, 132], [132, 156], [156, 180]]) {
  const nodes = lines.map(([top, bottom]) => ({ nodeSize: 2, rect: { top, bottom } }));
  const offs = []; let o = 0; for (const n of nodes) { offs.push(o); o += n.nodeSize; }
  const doc = { childCount: nodes.length, forEach: (fn) => nodes.forEach((n, i) => fn(n, offs[i])) };
  const view = { nodeDOM: (off) => ({ getBoundingClientRect: () => nodes[offs.indexOf(off)].rect }) };
  const wrapEl = { getBoundingClientRect: () => ({ top: 100, bottom: 188 }) };
  return { view, doc, wrapEl };
}

describe("doc insert gap sits in the gutter, never on a line", () => {
  it("the gap above the first line fills the padding above it", () => {
    const { view, doc, wrapEl } = setup();
    const b = nearestDocBoundary(view, doc, wrapEl, 103);
    expect(b.pos).toBe(0);
    expect(b.height).toBe(8);
    // centred in 100..108 → top 4 (wrapper-relative), so 0..8 — clear of the line at 8..32
    expect(b.top).toBe(4);
  });
  it("between two touching lines the gutter is zero tall (the strip falls back to its 4px floor)", () => {
    const { view, doc, wrapEl } = setup();
    const b = nearestDocBoundary(view, doc, wrapEl, 133);
    expect(b.pos).toBe(2);
    expect(b.height).toBe(0);
    expect(b.top).toBe(32);
  });
  it("a real gap between lines is used whole", () => {
    const { view, doc, wrapEl } = setup([[108, 132], [140, 164]]);
    const b = nearestDocBoundary(view, doc, wrapEl, 136);
    expect(b).toMatchObject({ pos: 2, height: 8, top: 36 });
  });
  it("below the last line the gap fills the bottom padding", () => {
    const { view, doc, wrapEl } = setup();
    const b = nearestDocBoundary(view, doc, wrapEl, 185);
    expect(b).toMatchObject({ pos: 6, height: 8, top: 84 });
  });
});
