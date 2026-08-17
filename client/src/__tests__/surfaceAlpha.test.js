// A surface's OWN stored colour has to render translucent, or the grid's
// wallpaper is invisible behind every container that has a colour.
//
// The CSS tokens (`--grid-surface-a`, `--occ-card-a`) only reach surfaces that
// fall back to the stylesheet. `ownStyle.bg` renders as an INLINE style, which
// beats any rule at any specificity — measured on prod, one such container came
// back `rgb(179,79,36)`, fully opaque. `styleToCSS` is the one chokepoint every
// surface passes through, so the alpha is applied there.
import { describe, it, expect } from "vitest";
import { styleToCSS, withSurfaceAlpha, SURFACE_ALPHA } from "../helpers/StyleHelpers";

describe("withSurfaceAlpha", () => {
  it("re-renders an opaque 6-digit hex as rgba at the surface alpha", () => {
    expect(withSurfaceAlpha("#b34f24")).toBe(`rgba(179, 79, 36, ${SURFACE_ALPHA})`);
  });

  it("expands 3-digit shorthand", () => {
    expect(withSurfaceAlpha("#fff")).toBe(`rgba(255, 255, 255, ${SURFACE_ALPHA})`);
  });

  it("reads the alpha out of an 8-digit hex", () => {
    // #…00 is fully transparent — already lighter than the cap, so it stays.
    expect(withSurfaceAlpha("#b34f2400")).toBe("rgba(179, 79, 36, 0)");
  });

  it("caps an opaque rgb()", () => {
    expect(withSurfaceAlpha("rgb(10, 20, 30)")).toBe(`rgba(10, 20, 30, ${SURFACE_ALPHA})`);
  });

  it("takes the MINIMUM rather than multiplying", () => {
    // A colour already stored translucent is already at least this light.
    // Multiplying would compound toward invisible every time it passed through.
    expect(withSurfaceAlpha("rgba(10, 20, 30, 0.2)")).toBe("rgba(10, 20, 30, 0.2)");
    expect(withSurfaceAlpha("rgba(10, 20, 30, 0.9)")).toBe(`rgba(10, 20, 30, ${SURFACE_ALPHA})`);
  });

  it("FAILS SAFE on anything it does not understand", () => {
    // Emitting a value the engine drops is worse than today's appearance: a
    // dropped background-color declaration leaves the surface unpainted.
    for (const v of ["rebeccapurple", "hsl(200 50% 40%)", "var(--x)", "transparent",
                     "linear-gradient(red, blue)", "#12345"]) {
      expect(withSurfaceAlpha(v)).toBe(v);
    }
    expect(withSurfaceAlpha(null)).toBe(null);
    expect(withSurfaceAlpha(undefined)).toBe(undefined);
  });
});

describe("styleToCSS applies it", () => {
  it("a stored bg comes out translucent", () => {
    expect(styleToCSS({ bg: "#b34f24" }).backgroundColor)
      .toBe(`rgba(179, 79, 36, ${SURFACE_ALPHA})`);
  });

  it("only the ALPHA is ours — the hue is the user's", () => {
    const { backgroundColor } = styleToCSS({ bg: "#123456" });
    expect(backgroundColor).toContain("18, 52, 86");
  });

  it("no bg still means no backgroundColor key at all", () => {
    expect("backgroundColor" in styleToCSS({ textColor: "#fff" })).toBe(false);
  });

  it("leaves every other property untouched", () => {
    const css = styleToCSS({ bg: "#000000", textColor: "#ffffff", borderColor: "#ff0000" });
    // Borders and text must NOT be faded — only surfaces are looked through.
    expect(css.color).toBe("#ffffff");
    expect(css.borderColor).toBe("#ff0000");
  });
});
