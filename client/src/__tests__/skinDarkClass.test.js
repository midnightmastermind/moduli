// __tests__/skinDarkClass.test.js
//
// THE `dark` CLASS FOLLOWS WHETHER A THEME IS LIGHT, NOT WHAT IT IS CALLED.
//
// `applySkin` used `!/light|stardew/.test(skin.theme)`. That was right while
// the only Stardew theme was the parchment one, and would have been wrong the
// moment a second arrived: "stardew-night" contains "stardew", so the night
// skin would have CLEARED Tailwind's `dark` class and half the app's `dark:`
// variants would have rendered their light forms over a night sky.
import { describe, it, expect, beforeEach } from "vitest";
import { applySkin } from "../hooks/useSkin";
import { getSkin, SKINS, LIGHT_THEMES } from "../helpers/skins";

const isDark = () => document.documentElement.classList.contains("dark");

beforeEach(() => { document.documentElement.className = ""; });

describe("applySkin — the dark class", () => {
  it("Stardew Night is dark", () => {
    applySkin(getSkin("stardew-night"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("stardew-night");
    expect(isDark()).toBe(true);
  });

  it("day Stardew is still light (the control)", () => {
    document.documentElement.classList.add("dark");
    applySkin(getSkin("stardew"));
    expect(isDark()).toBe(false);
  });

  it("every theme a skin pins is classified by the list, and the light ones are real themes", () => {
    const pinned = new Set(SKINS.map(s => s.theme).filter(Boolean));
    for (const t of LIGHT_THEMES) expect(pinned.has(t)).toBe(true);
    applySkin(getSkin("moduli-light"));
    expect(isDark()).toBe(false);
    applySkin(getSkin("midnight"));
    expect(isDark()).toBe(true);
  });
});

describe("Stardew Night's palette keeps the dimensions apart", () => {
  it("remaps into its own darker band", async () => {
    const { remapToPalette, parseColor, rgbToHsl } = await import("../helpers/skinPalettes");
    const out = remapToPalette("#b34f24", getSkin("stardew-night").palette);
    const c = parseColor(out);
    const [, , l] = rgbToHsl(c.r, c.g, c.b);
    expect(l).toBeGreaterThanOrEqual(34);
    expect(l).toBeLessThanOrEqual(58);
  });
});
