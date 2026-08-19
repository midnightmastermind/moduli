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
  it("snaps an opaque colour onto one of the palette's hues", () => {
    const out = remapToPalette("#98431f", stardew);   // the 136-row rust
    expect(out).toMatch(/^rgb\(/);
    expect(stardew.hues).toContain(Math.round(hueOf(out)));
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
