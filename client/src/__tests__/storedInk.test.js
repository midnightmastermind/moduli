// __tests__/storedInk.test.js
// The derived ink for a STORED occurrence colour.
//
// THE CONTRACT IS "ONLY WHEN THE DEFAULT FAILS". That is what makes this safe
// to put on the one chokepoint every data-driven background passes through:
// a row whose colour is already readable emits nothing and is byte-identical
// to what it was.
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs"; import path from "node:path"; import zlib from "node:zlib";
import {
  inkForStoredBg, setThemeInk, getThemeInk, styleToCSS, withSurfaceAlpha, setActiveSkin,
} from "../helpers/StyleHelpers";
import { contrastRatio, composite, AA_NORMAL } from "../helpers/contrast";

// The default dark theme: near-white ink on a near-black page.
const DARK = { ink: "rgb(247,249,252)", page: "hsl(222 30% 6%)" };

beforeEach(() => { setThemeInk(null); setActiveSkin(null); });

describe("inkForStoredBg", () => {
  it("says nothing when no theme has been published", () => {
    expect(inkForStoredBg("#ffffff")).toBe(null);
  });

  // The load-bearing case: an untouched row must stay untouched.
  it("leaves a colour the theme's own ink already reads on", () => {
    setThemeInk(DARK);
    expect(inkForStoredBg("#101820")).toBe(null); // dark bg, light ink — fine
  });

  it("flips to dark ink on a colour that swallows the theme's light ink", () => {
    setThemeInk(DARK);
    const ink = inkForStoredBg("#f0f0f0");
    expect(ink).toBeTruthy();
    expect(contrastRatio(ink, "#f0f0f0")).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  // A mid-tone where NEITHER candidate clears AA — best effort beats 1.4:1.
  // HONEST NOTE: this is a CONTRACT PIN, not coverage. `pickInk` picks between
  // the extremes, so once the default is below AA the flip is always better —
  // proven by sweeping the whole RGB space (smallest gain +0.23). No mutation
  // can make this fail, which is exactly why the redundant guard it once
  // described was removed rather than kept.
  it("never returns an ink worse than the one it replaces", () => {
    setThemeInk(DARK);
    for (const bg of ["#767676", "#8a7f6d", "#5a7a8a", "#a0522d"]) {
      const ink = inkForStoredBg(bg);
      if (!ink) continue;
      expect(contrastRatio(ink, bg)).toBeGreaterThan(contrastRatio(DARK.ink, bg));
    }
  });

  it("refuses a colour it cannot parse rather than guessing", () => {
    setThemeInk(DARK);
    expect(inkForStoredBg("oklab(0.5 0.1 0.1)")).toBe(null);
    expect(inkForStoredBg(null)).toBe(null);
  });
});

describe("styleToCSS — where the decision reaches the app", () => {
  it("emits no colour when the row's colour reads fine", () => {
    setThemeInk(DARK);
    expect(styleToCSS({ bg: "#101820" }).color).toBeUndefined();
  });

  it("emits a readable colour when it does not", () => {
    setThemeInk(DARK);
    setActiveSkin({ storedColorAlpha: 1 });   // the skins that render it opaque
    const css = styleToCSS({ bg: "#f0f0f0" });
    expect(css.color).toBeTruthy();
    expect(contrastRatio(css.color, css.backgroundColor)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  // Someone CHOSE this. Overriding a deliberate value is a different and much
  // worse bug than the one being fixed.
  it("never overrides an explicit textColor", () => {
    setThemeInk(DARK);
    setActiveSkin({ storedColorAlpha: 1 });
    expect(styleToCSS({ bg: "#f0f0f0", textColor: "#ff00ff" }).color).toBe("#ff00ff");
  });

  it("changes nothing at all when no theme is published", () => {
    expect(styleToCSS({ bg: "#f0f0f0" }).color).toBeUndefined();
  });
});

// ── THE MEASUREMENT, AS A TEST ─────────────────────────────────────────────
// The live grid's own stored colours, scored the way they render. This is the
// claim the change was made on, so it is pinned rather than left in a commit
// message where it cannot fail.
describe("the live grid's stored colours become readable", () => {
  const grid = JSON.parse(zlib.brotliDecompressSync(
    fs.readFileSync(path.resolve(__dirname, "fixtures/pomsGrid.json.br"))));
  const bgs = [];
  const eat = (o) => { const b = o?.ownStyle?.bg; if (typeof b === "string" && b.trim()) bgs.push(b.trim()); };
  (grid.occurrences || []).forEach(eat);
  (grid.modules || []).forEach(eat);

  it("has stored colours to score (control)", () => {
    // Without this the assertions below are satisfied by an empty list.
    expect(bgs.length).toBeGreaterThan(100);
  });

  it("leaves every row alone on a skin that dilutes stored colour", () => {
    setThemeInk(DARK);
    setActiveSkin({ storedColorAlpha: 0.24 });
    const touched = bgs.filter((b) => styleToCSS({ bg: b }).color != null);
    expect(touched.length).toBe(0);
  });

  it("fixes the unreadable rows on a skin that renders it opaque", () => {
    setThemeInk(DARK);
    setActiveSkin({ storedColorAlpha: 1 });
    // SCORE AGAINST WHAT IS ON SCREEN, which is what the decision itself does.
    // Many stored colours are ALREADY translucent (`rgba(248,113,113,0.10)`),
    // so scoring ink against the raw value measures a surface that is never
    // rendered — and reports failures the user would never see.
    const flat = (c) => {
      const f = composite(c, DARK.page);
      return `rgb(${Math.round(f.r)},${Math.round(f.g)},${Math.round(f.b)})`;
    };
    let broken = 0, stillBroken = 0;
    for (const b of bgs) {
      const css = styleToCSS({ bg: b });
      const surface = flat(css.backgroundColor);
      const before = contrastRatio(DARK.ink, surface);
      if (before == null || before >= AA_NORMAL) continue;
      broken++;
      const after = contrastRatio(css.color ?? DARK.ink, surface);
      expect(after).toBeGreaterThanOrEqual(before);   // never worse; equal = flip would not help
      if (after < AA_NORMAL) stillBroken++;
    }
    // The measured population on this grid; a guard against the fix silently
    // stopping applying, which a pass-rate alone would not catch.
    expect(broken).toBeGreaterThan(50);
    // Most clear AA outright; the remainder are mid-tones no ink can rescue,
    // and they are improved rather than left at 1.4:1.
    expect(stillBroken / broken).toBeLessThan(0.25);
  });
});
