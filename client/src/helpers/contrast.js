// helpers/contrast.js
// ============================================================
// WCAG CONTRAST, AND THE ONE QUESTION IT ANSWERS:
// *should the text on this background be light or dark?*
//
// This file exists because that question has been answered by HAND, per colour,
// per theme, four times in this codebase's history — and every time it was
// wrong somewhere. The record is specific:
//   2026-08-19 (6)  the account dropdowns scored 1.52:1 on Stardew
//   2026-08-19 (7)  moduli-light's green ink was `#16a34a` — EXACTLY the
//                   `--signal-pos` fill it sat on, i.e. 1.5:1 by construction
//   2026-09-04      the Command Center field menu in Tailwind pastels
// Each was found by a person looking at a screen and saying "I can't read
// that". This makes it a number instead.
//
// EVERYTHING HERE IS PURE. No DOM, no `getComputedStyle`, no canvas. That is
// deliberate: this file's own history records four probes that produced
// precise, quotable, WRONG figures because they sampled rendered pixels behind
// a wallpaper, or scored an `oklab()` colour as black. A function over two
// colour strings cannot make either mistake, and it runs in a test.
// ============================================================

/** Parse `#rgb`, `#rrggbb(aa)`, `rgb()/rgba()` (comma OR space/slash), `hsl()/hsla()`. */
export function parseColor(input) {
  if (typeof input !== "string") return null;
  const s = input.trim();

  const hex = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s);
  if (rgb) {
    const a = rgb[4] == null ? 1
      : rgb[4].endsWith("%") ? parseFloat(rgb[4]) / 100
      : parseFloat(rgb[4]);
    if (!Number.isFinite(a)) return null;
    return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a };
  }

  const hsl = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s);
  if (hsl) {
    const a = hsl[4] == null ? 1
      : hsl[4].endsWith("%") ? parseFloat(hsl[4]) / 100
      : parseFloat(hsl[4]);
    if (!Number.isFinite(a)) return null;
    return { ...hslToRgb(+hsl[1], +hsl[2], +hsl[3]), a };
  }

  return null;
}

function hslToRgb(h, s, l) {
  const S = s / 100, L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = L - c / 2;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

/**
 * Composite a (possibly translucent) colour over an opaque one.
 *
 * THIS IS THE STEP EVERY PREVIOUS ATTEMPT SKIPPED, and it is why they were
 * wrong. Nearly every ink token in this app is translucent —
 * `--text-muted` is `rgba(255,255,255,0.45)`. Scoring that as if it were opaque
 * white reports 21:1 against a dark surface. Composited, it is about 8:1. The
 * same error in the other direction is what let a 45%-white "muted" token ship
 * onto a light surface at under 2:1.
 */
export function composite(fg, bg) {
  const f = typeof fg === "string" ? parseColor(fg) : fg;
  const b = typeof bg === "string" ? parseColor(bg) : bg;
  if (!f || !b) return null;
  const a = f.a ?? 1;
  return {
    r: f.r * a + b.r * (1 - a),
    g: f.g * a + b.g * (1 - a),
    b: f.b * a + b.b * (1 - a),
    a: 1,
  };
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(color) {
  const c = typeof color === "string" ? parseColor(color) : color;
  if (!c) return null;
  const ch = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

/**
 * WCAG contrast ratio, 1–21. `fg` is composited over `bg` first, so a
 * translucent ink is scored as it is actually seen.
 */
export function contrastRatio(fg, bg) {
  const b = typeof bg === "string" ? parseColor(bg) : bg;
  if (!b) return null;
  const f = composite(fg, b);
  if (!f) return null;
  const lf = relativeLuminance(f), lb = relativeLuminance(b);
  if (lf == null || lb == null) return null;
  const [hi, lo] = lf > lb ? [lf, lb] : [lb, lf];
  return (hi + 0.05) / (lo + 0.05);
}

// WCAG AA. 4.5 for body text; large text (>=18.66px bold, or >=24px) may sit at
// 3.0. The lower bar is NOT the default here — this app's dense field pills and
// menu rows are 9-13px, which is the strict case.
export const AA_NORMAL = 4.5;
export const AA_LARGE = 3.0;

/**
 * Which of two inks to put on `bg` — the "light or dark?" answer.
 *
 * Returns whichever candidate CONTRASTS MORE, not whichever the background
 * "looks like". A mid-tone surface is exactly where eyeballing fails, and it is
 * where every one of the recorded failures lived.
 */
export function pickInk(bg, { light = "#ffffff", dark = "#111111" } = {}) {
  const cl = contrastRatio(light, bg);
  const cd = contrastRatio(dark, bg);
  if (cl == null || cd == null) return null;
  return cl >= cd
    ? { ink: light, ratio: cl, prefers: "light" }
    : { ink: dark, ratio: cd, prefers: "dark" };
}
