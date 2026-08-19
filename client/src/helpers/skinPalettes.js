// helpers/skinPalettes.js
//
// WHAT A SKIN DOES ABOUT COLOURS THAT LIVE IN THE DATA.
//
// `ownStyle.bg` renders as an INLINE style, which beats any stylesheet rule at
// any specificity — so a skin that only writes CSS cannot reach it. Measured on
// poms grid 2026-08-19:
//
//     424 surfaces carry a stored background
//       315 modules (231 instance · 73 container/board · 11 container/doc)
//           — every one of them styleMode:"own", so every one really renders
//       109 occurrence placements
//           — and `resolveContainerStyle` applies occurrence.ownStyle with NO
//             styleMode gate at all, so there is no switch to flip on those
//     36 distinct colours, clustering into 8 HUE FAMILIES
//
// The user's own suggestion was to flip everything to inherit. That instinct is
// right and the mechanism exists (`styleMode`) — but it covers 315 of the 424,
// it is a write to protected live data, and it is GLOBAL: switching back to the
// retro skin would need a second migration. Doing it at the RUNTIME chokepoint
// instead covers both halves, needs no write, and is reversible by picking a
// different skin.
//
// ── WHY A HUE MAP AND NOT A 36-ENTRY TABLE ──────────────────────────────────
// A table of today's 36 colours is wrong the first time the user picks a 37th.
// The stored palette is the nine wellness dimensions, and what distinguishes
// those dimensions is HUE — so a skin declares where each hue family lands and
// the map covers any colour, now or later.
//
// ── AND WHY LIGHTNESS IS NORMALISED, NOT PRESERVED ─────────────────────────
// The vintage palette and a pixel-art palette are not far apart in hue; they
// differ in SATURATION and LIGHTNESS. Snapping hue alone would barely change
// anything. Saturation is raised and lightness pulled into a band, which is what
// makes a muted 70s rust read as a Stardew barn.
//
// ── THE ONE THING THAT IS NOT REMAPPED, AND IT MATTERS ─────────────────────
// 106 of the 424 are `rgba(248,113,113,0.10)` — the signal-neg red at 10%, a
// STATE wash (missed / overdue), not a dimension colour. A colour that is
// already near-transparent is a tint over whatever is beneath it, so it is left
// alone: re-hueing it would turn "this one is overdue" into decoration.

/** Below this alpha a stored colour is a state WASH, not a surface colour. */
export const WASH_ALPHA_MAX = 0.35;

/**
 * Stardew Valley — hue anchors read off the farmhouse-sunset art the user
 * chose, not invented: barn crimson, sunset orange, wheat gold, crop green,
 * deep foliage, sky teal, twilight purple, dusk blue.
 *
 * `sat` / `light` are the band a remapped colour is pulled into. Pixel art is
 * saturated and mid-bright; the 70s palette is neither.
 */
export const STARDEW_PALETTE = {
  id: "stardew",
  hues: [340, 25, 42, 100, 150, 185, 265, 225],
  satRange: [55, 82],
  lightRange: [36, 62],
  // How far a colour is pulled TOWARD its family anchor. Not 1.
  //
  // The first version SNAPPED to the anchor, and rendering poms grid's real 424
  // colours as a before/after strip showed what that costs: NINE distinct source
  // oranges (#98431f, #b84329, #be762a, #b34f24, #b95d36, #dc5d41, #e08b31,
  // #d94f30, #e29441) all landed within four RGB points of each other. Those nine
  // are different things on that grid, and a remap that erases distinctions the
  // user relies on is worse than no remap. Pulling part of the way lands the
  // family in the pixel-art register while keeping its members apart.
  huePull: 0.55,
  // The source lightness range the palette's band is mapped ONTO. Clamping into
  // the band instead flattened every one of those oranges to the same value,
  // because almost all stored colours sit between 24% and 56%.
  sourceLightRange: [22, 58],
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Circular distance between two hues, in degrees (0-180). */
export function hueDistance(a, b) {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/** The palette hue nearest `h`. */
export function nearestHue(h, hues) {
  let best = hues[0], bestD = Infinity;
  for (const cand of hues) {
    const d = hueDistance(h, cand);
    if (d < bestD) { bestD = d; best = cand; }
  }
  return best;
}

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (!d) return [0, 0, l * 100];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? ((g - b) / d + (g < b ? 6 : 0))
        : mx === g ? ((b - r) / d + 2)
        : ((r - g) / d + 4);
  return [h * 60, s * 100, l * 100];
}

export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
      h < 60  ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** Parse the two shapes the colour picker and the seed actually write. */
export function parseColor(color) {
  if (typeof color !== "string") return null;
  const s = color.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map(c => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s);
  if (rgb) {
    const [, r, g, b, rawA] = rgb;
    const a = rawA == null ? 1 : rawA.endsWith("%") ? parseFloat(rawA) / 100 : parseFloat(rawA);
    if (!Number.isFinite(a)) return null;
    return { r: +r, g: +g, b: +b, a };
  }
  return null;
}

/**
 * Re-render a stored colour in the skin's palette.
 *
 * Returns the colour UNCHANGED — never a guess — when there is no palette, when
 * the value is a shape we do not parse (a named colour, hsl, a gradient), when
 * it carries no chroma (a grey is a grey in every palette), or when it is a
 * near-transparent state wash. Failing to today's appearance is always better
 * than emitting something the engine drops or the user did not mean.
 */
export function remapToPalette(color, palette) {
  if (!palette) return color;
  const c = parseColor(color);
  if (!c) return color;
  if (c.a <= WASH_ALPHA_MAX) return color;

  const [h, s, l] = rgbToHsl(c.r, c.g, c.b);
  if (s < 8) return color;

  const [satLo, satHi] = palette.satRange;
  const [liLo, liHi] = palette.lightRange;
  const [srcLo, srcHi] = palette.sourceLightRange || [22, 58];
  const pull = palette.huePull ?? 1;

  // Pull TOWARD the family anchor, the short way round the circle. Snapping to
  // it collapses every member of a family onto one colour — measured on poms
  // grid's real palette, nine oranges became one.
  const anchor = nearestHue(h, palette.hues);
  const delta = ((anchor - h + 540) % 360) - 180;

  // Map the source's own lightness RANGE onto the palette's band, rather than
  // clamping into it: almost every stored colour sits between 24% and 56%, so a
  // clamp flattens the whole set and a container stops reading lighter than the
  // rows inside it.
  const t = (l - srcLo) / (srcHi - srcLo);

  const [r2, g2, b2] = hslToRgb(
    h + delta * pull,
    clamp(s * 1.35, satLo, satHi),
    clamp(liLo + t * (liHi - liLo), liLo, liHi),
  );
  return c.a >= 1 ? `rgb(${r2}, ${g2}, ${b2})` : `rgba(${r2}, ${g2}, ${b2}, ${c.a})`;
}
