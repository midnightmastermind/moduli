import { describe, it, expect } from "vitest";
import { resolveContainerChildLayout, CHILD_LAYOUT_DEFAULTS }
  from "../helpers/containerChildLayout";

describe("resolveContainerChildLayout", () => {
  // ── The regression guard that matters most ────────────────────────────────
  // Every container on the grid that states no mode must render EXACTLY as it
  // did before this helper existed: no class, no CSS vars. 539 nested board
  // containers (every schedule time slot among them) go through here.
  it("returns stack with no class and no vars when no mode is set", () => {
    for (const r of [null, undefined, {}, { mode: null }, { mode: "grid" }, { childMinWidth: 300 }]) {
      const out = resolveContainerChildLayout(r);
      expect(out.mode).toBe("stack");
      expect(out.className).toBe("");
      expect(out.vars).toBeNull();
    }
  });

  // ── wrap keeps its exact pre-existing numbers ─────────────────────────────
  // These four values were inline in ModuleContainer and every tracker tile on
  // the grid renders from them. If this test moves, tiles moved.
  it("wrap keeps the tile defaults it already had (132 / 100% / 200 / 8)", () => {
    const out = resolveContainerChildLayout({ mode: "wrap" });
    expect(out.className).toBe("container-items--wrap");
    expect(out.vars).toEqual({
      "--child-w": "132px", "--child-max-w": "100%", "--child-h": "200px", "--child-gap": "8px",
    });
  });

  // ── the new mode ──────────────────────────────────────────────────────────
  it("flex-row gets its own class and PageBoard's column defaults", () => {
    const out = resolveContainerChildLayout({ mode: "flex-row" });
    expect(out.mode).toBe("flex-row");
    expect(out.className).toBe("container-items--row");
    expect(out.vars).toEqual({
      "--child-w": "280px", "--child-max-w": "360px", "--child-h": "420px", "--child-gap": "12px",
    });
  });

  // THE DISCRIMINATOR between the two across-modes. Both lay children out in a
  // row; only one wraps. A kanban whose columns wrap is not a kanban, so the
  // classes must never collapse into one.
  it("wrap and flex-row are different classes and different defaults", () => {
    const w = resolveContainerChildLayout({ mode: "wrap" });
    const r = resolveContainerChildLayout({ mode: "flex-row" });
    expect(w.className).not.toBe(r.className);
    expect(w.vars["--child-w"]).not.toBe(r.vars["--child-w"]);
  });

  it("every cascade key overrides its per-mode default", () => {
    const out = resolveContainerChildLayout({
      mode: "flex-row", childMinWidth: 300, childMaxWidth: 300, childMaxHeight: 640, childGap: 20,
    });
    expect(out.vars).toEqual({
      "--child-w": "300px", "--child-max-w": "300px", "--child-h": "640px", "--child-gap": "20px",
    });
  });

  // gap is the one key where 0 is a real answer ("no gutter"), so it must not
  // be swallowed by the falsy check the width/height keys use.
  it("accepts a gap of 0 but ignores a non-positive width", () => {
    const out = resolveContainerChildLayout({ mode: "flex-row", childGap: 0, childMinWidth: 0 });
    expect(out.vars["--child-gap"]).toBe("0px");
    expect(out.vars["--child-w"]).toBe(`${CHILD_LAYOUT_DEFAULTS["flex-row"].minW}px`);
  });
});
