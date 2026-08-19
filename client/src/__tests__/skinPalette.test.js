// __tests__/skinPalette.test.js
//
// A skin has to do something about colours that live in the DATA. `ownStyle.bg`
// renders as an inline style, so no stylesheet can reach it — measured on poms
// grid 2026-08-19: 424 surfaces, 36 distinct colours, 8 hue families.
//
// The refusals are the entire risk here. A remap that guesses at a colour it
// does not understand is worse than one that leaves it alone, because the user
// sees a colour they never picked and cannot trace where it came from.
import { describe, it, expect } from "vitest";
import { remapToPalette, nearestHue, hueDistance, rgbToHsl, parseColor, WASH_ALPHA_MAX } from "../helpers/skinPalettes";
import { SKINS, getSkin, resolveSkinId, DEFAULT_SKIN } from "../helpers/skins";

const stardew = getSkin("stardew").palette;
const hueOf = (c) => { const p = parseColor(c); return rgbToHsl(p.r, p.g, p.b)[0]; };

describe("the skin registry", () => {
  it("still offers the five looks that existed before skins did", () => {
    const ids = SKINS.map(s => s.id);
    for (const id of ["moduli-dark", "moduli-light", "midnight", "vintage-light", "vintage-dark"]) {
      expect(ids).toContain(id);
    }
  });

  it("names today's look as the default, so an untouched grid does not move", () => {
    expect(DEFAULT_SKIN).toBe("retro-rainbow");
    const retro = getSkin("retro-rainbow");
    expect(retro.wallpaper).toContain("grid-wallpaper");
    expect(retro.surfaceAlpha).toBe(0.24);   // the shipped value
    expect(retro.theme).toBeNull();          // it has never pinned one
  });

  it("gives every plain skin a theme, no wallpaper and no rainbow", () => {
    for (const id of ["moduli-dark", "moduli-light", "midnight", "vintage-light", "vintage-dark"]) {
      const s = getSkin(id);
      expect(s.theme).toBe(id);
      expect(s.wallpaper).toBeNull();
      expect(s.rainbow).toBe(false);
    }
  });

  it("falls back to a real skin for an unknown id rather than undefined", () => {
    expect(getSkin("no-such-skin").id).toBe(DEFAULT_SKIN);
  });
});

describe("resolveSkinId — per grid, then the account, then the default", () => {
  it("prefers the grid's own choice", () => {
    expect(resolveSkinId({ meta: { skin: "stardew" } }, "midnight")).toBe("stardew");
  });
  it("falls back to the account-wide pick for a grid that has not chosen", () => {
    expect(resolveSkinId({ meta: {} }, "midnight")).toBe("midnight");
  });
  it("falls back to the default when neither exists", () => {
    expect(resolveSkinId(null, null)).toBe(DEFAULT_SKIN);
  });
});

describe("remapToPalette — the refusals", () => {
  it("returns the colour untouched when the skin declares no palette", () => {
    expect(remapToPalette("#98431f", null)).toBe("#98431f");
  });

  it("leaves a near-transparent STATE WASH alone", () => {
    // 106 of poms grid's 424 are the signal-neg red at 10% — "this one is
    // overdue", not a dimension colour. Re-hueing it turns a signal into
    // decoration.
    const wash = "rgba(248,113,113,0.10)";
    expect(remapToPalette(wash, stardew)).toBe(wash);
    expect(WASH_ALPHA_MAX).toBeGreaterThan(0.10);
  });

  it("leaves a GREY alone — a grey is a grey in every palette", () => {
    expect(remapToPalette("#3b3b3b", stardew)).toBe("#3b3b3b");
  });

  it("leaves a shape it does not parse alone rather than guessing", () => {
    for (const c of ["rebeccapurple", "hsl(20 50% 40%)", "linear-gradient(red, blue)", "var(--x)"]) {
      expect(remapToPalette(c, stardew)).toBe(c);
    }
  });
});

describe("remapToPalette — what it does change", () => {
  it("pulls an opaque colour TOWARD its family anchor without landing on it", () => {
    // Deliberately not a snap. Snapping collapsed nine oranges into one — see
    // the "must not COLLAPSE a family" block below, which is why this contract
    // changed. The colour has to MOVE toward the palette, and has to stop short.
    const before = hueOf("#98431f");                  // the 136-row rust, 18°
    const out = remapToPalette("#98431f", stardew);
    expect(out).toMatch(/^rgb\(/);
    const after = hueOf(out);
    expect(hueDistance(after, 25)).toBeLessThan(hueDistance(before, 25));   // moved toward
    expect(stardew.hues).not.toContain(Math.round(after));                  // …but not onto
  });

  it("keeps DIFFERENT families different — the nine dimensions stay readable", () => {
    const rust = remapToPalette("#98431f", stardew);   // 18°
    const teal = remapToPalette("#35796b", stardew);   // 168°
    const plum = remapToPalette("#6a293e", stardew);   // 341°
    const hues = [rust, teal, plum].map(hueOf);
    expect(new Set(hues.map(Math.round)).size).toBe(3);
  });

  it("pulls saturation and lightness into the skin's band", () => {
    const p = parseColor(remapToPalette("#98431f", stardew));
    const [, s, l] = rgbToHsl(p.r, p.g, p.b);
    expect(s).toBeGreaterThanOrEqual(stardew.satRange[0] - 0.5);
    expect(s).toBeLessThanOrEqual(stardew.satRange[1] + 0.5);
    expect(l).toBeGreaterThanOrEqual(stardew.lightRange[0] - 0.5);
    expect(l).toBeLessThanOrEqual(stardew.lightRange[1] + 0.5);
  });

  it("preserves alpha on a translucent-but-not-wash colour", () => {
    const out = remapToPalette("rgba(152,67,31,0.6)", stardew);
    expect(out).toMatch(/rgba\(.*0\.6\)$/);
  });

  it("keeps a lighter source lighter than a darker one in the same family", () => {
    // #b95d36 is a lighter rust than #98431f; a container is meant to read
    // lighter than the rows inside it.
    const lightL = (() => { const p = parseColor(remapToPalette("#b95d36", stardew)); return rgbToHsl(p.r,p.g,p.b)[2]; })();
    const darkL  = (() => { const p = parseColor(remapToPalette("#98431f", stardew)); return rgbToHsl(p.r,p.g,p.b)[2]; })();
    expect(lightL).toBeGreaterThan(darkL);
  });
});

describe("hue helpers", () => {
  it("measures hue distance the short way round the circle", () => {
    expect(hueDistance(350, 10)).toBe(20);
    expect(hueDistance(10, 350)).toBe(20);
  });
  it("snaps to the nearest anchor across the 0/360 seam", () => {
    expect(nearestHue(355, [340, 25])).toBe(340);
    expect(nearestHue(5, [340, 25])).toBe(25);
  });
});

describe("remapToPalette — it must not COLLAPSE a family", () => {
  // The first version snapped hue to the anchor and clamped lightness into the
  // band. Rendering poms grid's real 424 colours as a before/after strip showed
  // what that cost: these nine distinct oranges all landed within four RGB
  // points of each other. They are different things on that grid, and a remap
  // that erases distinctions the user relies on is worse than no remap.
  const NINE_ORANGES = ["#98431f", "#b84329", "#be762a", "#b34f24", "#b95d36",
                        "#dc5d41", "#e08b31", "#d94f30", "#e29441"];

  const dist = (a, b) => {
    const p = parseColor(a), q = parseColor(b);
    return Math.abs(p.r - q.r) + Math.abs(p.g - q.g) + Math.abs(p.b - q.b);
  };

  it("keeps every one of the nine oranges distinguishable from the others", () => {
    const out = NINE_ORANGES.map(c => remapToPalette(c, stardew));
    expect(new Set(out).size).toBe(9);
    // The threshold is RELATIVE to what the source already had, which is the
    // only defensible one: two of these nine are near-identical in the source
    // (#b84329 and #b34f24 are 22 apart), so an absolute floor would be either
    // unreachable or meaningless. Measured: source 22, snap 4 (18%), pull 13
    // (59%). Keeping over half the separation the user actually had is the
    // contract; a snap fails it by a wide margin.
    const minOf = (arr) => {
      let m = Infinity;
      for (let i = 0; i < arr.length; i++)
        for (let j = i + 1; j < arr.length; j++) m = Math.min(m, dist(arr[i], arr[j]));
      return m;
    };
    expect(minOf(out)).toBeGreaterThan(minOf(NINE_ORANGES) * 0.5);
  });

  it("preserves the family's ORDER — a lighter source stays lighter", () => {
    const l = (c) => { const p = parseColor(remapToPalette(c, stardew)); return rgbToHsl(p.r, p.g, p.b)[2]; };
    expect(l("#e29441")).toBeGreaterThan(l("#98431f"));
    expect(l("#e08b31")).toBeGreaterThan(l("#b34f24"));
  });

  it("still lands the family in the palette's register, not on its original hue", () => {
    // Pulled toward the anchor, not left alone: the point is a pixel-art palette.
    const before = hueOf("#98431f");
    const after = hueOf(remapToPalette("#98431f", stardew));
    expect(Math.abs(after - before)).toBeGreaterThan(1);
    expect(hueDistance(after, 25)).toBeLessThan(hueDistance(before, 25));
  });
});
