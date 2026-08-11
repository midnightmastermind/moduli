// module.layout (the rich CSS editor) → the shape keys the renderers read.
import { describe, it, expect } from "vitest";
import { layoutToSurfaceShape, resolveLayoutCascade } from "../helpers/layoutCascade";

describe("layoutToSurfaceShape", () => {
  it("returns null for an absent layout, so an untouched module is unchanged", () => {
    // THE PROPERTY THAT MAKES THIS SAFE EVERYWHERE AT ONCE.
    expect(layoutToSurfaceShape(null)).toBeNull();
    expect(layoutToSurfaceShape({})).toBeNull();
  });

  it("maps a wrapping flex to the container's grid-of-squares mode", () => {
    expect(layoutToSurfaceShape({ display: "flex", wrap: "wrap", minWidthPx: 168, gapPx: 8 }))
      .toEqual({ mode: "wrap", childMinWidth: 168, childGap: 8 });
  });

  it("maps a NON-wrapping flex to side-by-side columns", () => {
    expect(layoutToSurfaceShape({ display: "flex", wrap: "nowrap" }).mode).toBe("flex-row");
  });

  it("maps grid + columns", () => {
    expect(layoutToSurfaceShape({ display: "grid", columns: 3 }))
      .toEqual({ mode: "grid", columns: 3 });
  });

  it("treats 0 as the editor's UNSET, not a real zero", () => {
    // LayoutForm's presets store 0 for "auto"; a 0 min-width would collapse a
    // column to nothing.
    expect(layoutToSurfaceShape({ display: "grid", columns: 0, minWidthPx: 0, maxWidthPx: 0 }))
      .toEqual({ mode: "grid" });
  });

  it("carries a height cap through", () => {
    expect(layoutToSurfaceShape({ maxHeightPx: 200 })).toEqual({ childMaxHeight: 200 });
  });
});

describe("resolveLayoutCascade — module.layout feeds a surface", () => {
  const withLayout = (layout, cascade) => ({
    leaf: { id: "m", layout },
    leafOcc: { id: "o", meta: cascade ? { layoutCascade: cascade } : {} },
  });

  it("a container picks up its module's CSS layout", () => {
    const { resolved } = resolveLayoutCascade(withLayout({ display: "flex", wrap: "wrap", minWidthPx: 168 }), "container");
    expect(resolved.mode).toBe("wrap");
    expect(resolved.childMinWidth).toBe(168);
  });

  it("an EXPLICIT cascade value still wins over the module layout", () => {
    // The discriminating case: the layout menu's own value is the more
    // specific statement, so it must not be overwritten by the module default.
    const { resolved } = resolveLayoutCascade(
      withLayout({ display: "grid", columns: 4 }, { mode: "wrap" }), "container");
    expect(resolved.mode).toBe("wrap");
  });

  it("changes nothing when the module has no layout", () => {
    const { resolved } = resolveLayoutCascade(withLayout(null), "container");
    const base = resolveLayoutCascade({ leafOcc: { id: "o", meta: {} } }, "container").resolved;
    expect(resolved).toEqual(base);
  });
});
