// __tests__/contrast.test.js
// The calculator is checked against values whose answer is already known
// (WCAG's own reference pairs) — a contrast function that agrees with itself
// proves nothing. Then the THEME TOKENS are scored, so the next person to
// hand-pick an ink gets a failing build instead of a user who cannot read it.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  parseColor, composite, relativeLuminance, contrastRatio, pickInk, AA_NORMAL,
} from "../helpers/contrast";

describe("parseColor", () => {
  it("reads the notations this stylesheet actually uses", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#0e1b30")).toEqual({ r: 14, g: 27, b: 48, a: 1 });
    expect(parseColor("rgba(255,255,255,0.45)")).toEqual({ r: 255, g: 255, b: 255, a: 0.45 });
    expect(parseColor("rgb(6 182 212 / 0.5)")).toEqual({ r: 6, g: 182, b: 212, a: 0.5 });
    const hsl = parseColor("hsl(222 30% 6%)");
    expect(hsl.r).toBeCloseTo(11, 0);
  });

  it("returns null rather than a wrong number for what it cannot read", () => {
    // `oklab()` is the shape that made an earlier probe score a legible pill as
    // BLACK and report 1.12:1. Refusing beats guessing.
    expect(parseColor("oklab(0.5 0.1 0.1)")).toBe(null);
    expect(parseColor("var(--x)")).toBe(null);
    expect(parseColor(null)).toBe(null);
  });
});

describe("contrastRatio — checked against known answers", () => {
  it("matches WCAG's reference pairs", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 2);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it("is symmetric — the ratio does not care which is ink", () => {
    expect(contrastRatio("#123456", "#abcdef"))
      .toBeCloseTo(contrastRatio("#abcdef", "#123456"), 6);
  });

  // THE STEP EVERY PREVIOUS ATTEMPT SKIPPED. Nearly every ink token here is
  // translucent; scoring one as opaque overstates it by a factor of two or more.
  it("composites a translucent ink before scoring it", () => {
    const opaque = contrastRatio("rgb(255,255,255)", "#0e1b30");
    const half = contrastRatio("rgba(255,255,255,0.5)", "#0e1b30");
    expect(opaque).toBeGreaterThan(15);
    expect(half).toBeLessThan(opaque / 2);
  });

  it("composite() lands exactly halfway at 50%", () => {
    const c = composite("rgba(0,0,0,0.5)", "#ffffff");
    expect(c.r).toBeCloseTo(127.5, 1);
  });

  it("luminance orders as the eye does", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 3);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 3);
    expect(relativeLuminance("#ff0000")).toBeLessThan(relativeLuminance("#00ff00"));
  });
});

describe("pickInk — light or dark?", () => {
  it("answers by contrast, not by what the surface looks like", () => {
    expect(pickInk("#000000").prefers).toBe("light");
    expect(pickInk("#ffffff").prefers).toBe("dark");
  });

  // The mid-tone case is exactly where eyeballing fails, and where every
  // recorded failure in this codebase lived.
  it("resolves a mid-tone surface rather than coin-flipping", () => {
    const r = pickInk("#767676");
    expect(["light", "dark"]).toContain(r.prefers);
    expect(r.ratio).toBeGreaterThan(1);
  });
});

// ── THE GUARD ──────────────────────────────────────────────────────────────
// Reads the REAL stylesheet. Hand-picking an unreadable ink now fails the
// build instead of reaching a person who has to squint at it and report it.
describe("every theme's ink clears WCAG AA on its own surfaces", () => {
  const css = fs.readFileSync(
    path.resolve(__dirname, "../index.css"), "utf8");

  const blockOf = (sel) => {
    const i = css.indexOf(`${sel} {`);
    if (i < 0) return {};
    let depth = 0, j = css.indexOf("{", i);
    const start = j + 1;
    for (; j < css.length; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}" && --depth === 0) break;
    }
    const out = {};
    for (const m of css.slice(start, j).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      out[m[1]] = m[2].trim();
    }
    return out;
  };

  const resolve = (v, tok, d = 0) => {
    if (!v || d > 8) return null;
    let s = v.trim(), m;
    while ((m = /var\((--[\w-]+)(?:\s*,\s*([^)]*))?\)/.exec(s))) {
      const val = tok[m[1]] ?? m[2];
      if (val == null) return null;
      s = s.slice(0, m.index) + val.trim() + s.slice(m.index + m[0].length);
      if (d++ > 8) return null;
    }
    if (/^[\d.]+\s+[\d.]+%\s+[\d.]+%$/.test(s)) s = `hsl(${s})`;
    if (/^[\d.]+\s+[\d.]+\s+[\d.]+$/.test(s)) s = `rgb(${s.replace(/\s+/g, ",")})`;
    return parseColor(s) ? s : null;
  };

  const base = blockOf(":root");
  const THEMES = ["moduli-dark", "moduli-light", "midnight",
                  "vintage-light", "vintage-dark", "stardew"];

  // A translucent SURFACE has to be flattened over the page first, or ink and
  // background are compared as two nearly identical colours and the pair reads
  // ~1.00 — an empty sample, not a finding.
  const flatten = (surf, page) => {
    const p = parseColor(surf);
    if (!p || (p.a ?? 1) === 1) return surf;
    const f = composite(surf, page);
    return `rgb(${Math.round(f.r)},${Math.round(f.g)},${Math.round(f.b)})`;
  };

  it.each(THEMES)("%s", (theme) => {
    const tok = { ...base, ...blockOf(`[data-theme="${theme}"]`) };
    const page = resolve(tok["--body-bg"], tok);
    expect(page, `${theme}: --body-bg must resolve`).toBeTruthy();
    const input = flatten(resolve(tok["--input-bg"], tok), page);

    for (const ink of ["--text-primary", "--text-muted", "--text-faint"]) {
      const fg = resolve(tok[ink], tok);
      expect(fg, `${theme}: ${ink} must resolve`).toBeTruthy();
      for (const [surf, name] of [[page, "--body-bg"], [input, "--input-bg"]]) {
        const r = contrastRatio(fg, surf);
        expect(r, `${theme}: ${ink} on ${name} is ${r?.toFixed(2)}:1`)
          .toBeGreaterThanOrEqual(AA_NORMAL);
      }
    }
  });

  // Without this the suite above is satisfied by a stylesheet where nothing
  // resolves — the assertions would simply never run against real values.
  it("is scoring real values (control)", () => {
    const tok = { ...base, ...blockOf('[data-theme="stardew"]') };
    const page = resolve(tok["--body-bg"], tok);
    expect(parseColor(page)).toBeTruthy();
    // And the guard must be able to FAIL: a deliberately faint ink is caught.
    expect(contrastRatio("rgba(255,255,255,0.15)", page)).toBeLessThan(AA_NORMAL);
  });
});
