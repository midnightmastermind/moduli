// LAYOUT DOES NOT CASCADE (user 2026-08-11: "we want layout, just not cascaded").
// A surface arranges its own children; an ancestor does not arrange them for it.
// VIEW keys are a different question and still push down.
import { describe, it, expect } from "vitest";
import { resolveLayoutCascade, stripSurfaceShape, SURFACE_SHAPE_KEYS }
  from "../helpers/layoutCascade";

const pageWith = (rule) => ({ pageOcc: { id: "p", meta: { layoutCascade: rule } } });

describe("stripSurfaceShape", () => {
  it("removes every shape key and keeps the view keys", () => {
    const out = stripSurfaceShape({
      mode: "wrap", childMinWidth: 168, columns: 3,     // shape
      dragInView: "representation", locked: true,        // view
    });
    expect(out).toEqual({ dragInView: "representation", locked: true });
  });
  it("returns null when a rule is nothing BUT shape", () => {
    expect(stripSurfaceShape({ mode: "wrap", childMinWidth: 168 })).toBeNull();
  });
  it("returns null for an absent rule", () => {
    expect(stripSurfaceShape(null)).toBeNull();
  });
  it("covers the whole declared key set, so a new key cannot leak", () => {
    const all = Object.fromEntries(SURFACE_SHAPE_KEYS.map((k) => [k, "x"]));
    expect(stripSurfaceShape(all)).toBeNull();
  });
});

describe("resolveLayoutCascade — a PAGE does not arrange a CONTAINER's children", () => {
  it("does NOT inherit an ancestor page's mode", () => {
    // THE REGRESSION THIS EXISTS FOR: the Trackers page stored mode:"wrap" and
    // it reached every container beneath it, whatever kind they were.
    const { resolved } = resolveLayoutCascade(pageWith({ mode: "wrap", childMinWidth: 168 }), "container");
    expect(resolved.mode).not.toBe("wrap");
    expect(resolved.childMinWidth).toBeUndefined();
  });

  it("STILL inherits an ancestor page's VIEW keys", () => {
    // The discriminating sibling: turning the walker off entirely would break
    // this, which is why the split is by KEY.
    const { resolved } = resolveLayoutCascade(pageWith({ mode: "wrap", locked: true }), "container");
    expect(resolved.locked).toBe(true);
  });

  it("a surface still reads its OWN shape", () => {
    const ctx = { leafOcc: { id: "c", meta: { layoutCascade: { mode: "wrap", childMinWidth: 168 } } } };
    const { resolved } = resolveLayoutCascade(ctx, "container");
    expect(resolved.mode).toBe("wrap");
    expect(resolved.childMinWidth).toBe(168);
  });

  it("a container's own shape is not overridden by its ancestor's", () => {
    const ctx = {
      pageOcc: { id: "p", meta: { layoutCascade: { mode: "grid", columns: 4 } } },
      leafOcc: { id: "c", meta: { layoutCascade: { mode: "wrap" } } },
    };
    expect(resolveLayoutCascade(ctx, "container").resolved.mode).toBe("wrap");
  });
});
