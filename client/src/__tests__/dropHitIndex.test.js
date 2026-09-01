/**
 * dropHitIndex — the rect fast path for the drag hit-test.
 *
 * The engine call it replaces measured 12.9-13.6ms per hit-test on the user's
 * tablet, ~130-180 times a drag. These tests are about the ONE failure that
 * matters: a WRONG hit. A miss costs a fallback to `elementsFromPoint` and is
 * invisible; a wrong hit drops the user's row into the wrong container.
 */
import { describe, it, expect } from "vitest";
import { buildHitIndex, findAt, domDepth } from "../helpers/dropHitIndex.js";

// Minimal fake elements: a parentElement chain for depth, nothing else.
function el(name, parent = null) {
  return { name, parentElement: parent };
}
const accepts = (...types) => ({ acceptsRef: { current: types } });
const ANY = { acceptsRef: { current: [] } };

/** entries + a rect map, the shape buildHitIndex takes from the registry. */
function build(defs) {
  const rects = new Map(defs.map((d) => [d.el, d.rect]));
  return buildHitIndex(
    defs.map((d) => [d.el, d.config ?? ANY]),
    { rectOf: (e) => rects.get(e) },
  );
}
const R = (left, top, right, bottom) => ({
  left, top, right, bottom, width: right - left, height: bottom - top,
});

describe("buildHitIndex", () => {
  it("drops zero-area targets", () => {
    const a = el("a"), b = el("b");
    const idx = build([
      { el: a, rect: R(0, 0, 10, 10) },
      { el: b, rect: R(5, 5, 5, 20) },   // zero width — can contain no point
    ]);
    expect(idx.map((c) => c.el.name)).toEqual(["a"]);
  });

  it("survives an element whose rect read throws", () => {
    // A detached node mid-drag must not take the whole index down with it.
    const a = el("a"), bad = el("bad");
    const idx = buildHitIndex(
      [[bad, ANY], [a, ANY]],
      { rectOf: (e) => { if (e === bad) throw new Error("detached"); return R(0, 0, 10, 10); } },
    );
    expect(idx.map((c) => c.el.name)).toEqual(["a"]);
  });

  it("records DOM depth so the innermost target can win", () => {
    const root = el("root");
    const mid = el("mid", root);
    const leaf = el("leaf", mid);
    expect(domDepth(root)).toBe(0);
    expect(domDepth(leaf)).toBe(2);
  });
});

describe("findAt", () => {
  const outer = el("outer");
  const inner = el("inner", outer);

  it("returns the DEEPEST containing target, not the first", () => {
    // The real shape: an instance nested inside a container, both registered,
    // both containing the point. The engine returns the innermost; so must we.
    const idx = build([
      { el: outer, rect: R(0, 0, 100, 100) },
      { el: inner, rect: R(10, 10, 50, 50) },
    ]);
    expect(findAt(idx, 20, 20, "instance", null).el.name).toBe("inner");
    // outside the inner rect, the outer one is still correct
    expect(findAt(idx, 80, 80, "instance", null).el.name).toBe("outer");
  });

  it("returns null when the point is outside everything", () => {
    const idx = build([{ el: outer, rect: R(0, 0, 100, 100) }]);
    expect(findAt(idx, 200, 200, "instance", null)).toBe(null);
  });

  it("DEFERS on ambiguity rather than guessing", () => {
    // Two accepting targets at the same depth, both containing the point.
    // Ordering them needs the paint order only the engine has. Guessing is a
    // coin flip on which container the drop lands in — so: null, and the
    // caller asks the engine.
    const a = el("a"), b = el("b");
    const idx = build([
      { el: a, rect: R(0, 0, 100, 100) },
      { el: b, rect: R(50, 50, 150, 150) },
    ]);
    expect(findAt(idx, 60, 60, "instance", null)).toBe(null);   // overlap
    expect(findAt(idx, 10, 10, "instance", null).el.name).toBe("a");  // a alone
    expect(findAt(idx, 140, 140, "instance", null).el.name).toBe("b"); // b alone
  });

  it("honours the accepts filter, and an empty list means anything", () => {
    const only = el("only");
    const idx = build([{ el: only, rect: R(0, 0, 100, 100), config: accepts("panel") }]);
    expect(findAt(idx, 10, 10, "panel", null).el.name).toBe("only");
    expect(findAt(idx, 10, 10, "instance", null)).toBe(null);

    const anyIdx = build([{ el: only, rect: R(0, 0, 100, 100), config: ANY }]);
    expect(findAt(anyIdx, 10, 10, "instance", null).el.name).toBe("only");
  });

  it("skips the dragged element itself but keeps its ancestors", () => {
    // The engine walk steps over sourceEl and keeps climbing; a row dragged
    // out of its own container must still be able to drop back into it.
    const idx = build([
      { el: outer, rect: R(0, 0, 100, 100) },
      { el: inner, rect: R(10, 10, 50, 50) },
    ]);
    expect(findAt(idx, 20, 20, "instance", inner).el.name).toBe("outer");
  });

  it("treats rect edges as inside, matching a point on a boundary", () => {
    const idx = build([{ el: outer, rect: R(0, 0, 100, 100) }]);
    expect(findAt(idx, 0, 0, "instance", null).el.name).toBe("outer");
    expect(findAt(idx, 100, 100, "instance", null).el.name).toBe("outer");
    expect(findAt(idx, 101, 100, "instance", null)).toBe(null);
  });

  it("a non-accepting target does not shadow a deeper accepting one", () => {
    // The refusal must not count as the deepest candidate and blank the hit.
    const idx = build([
      { el: outer, rect: R(0, 0, 100, 100), config: ANY },
      { el: inner, rect: R(10, 10, 50, 50), config: accepts("panel") },
    ]);
    expect(findAt(idx, 20, 20, "instance", null).el.name).toBe("outer");
  });
});
