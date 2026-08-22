// __tests__/skinCssParity.test.js
//
// THE REGISTRY AND THE STYLESHEET DECLARE THE SAME TOKENS, AND THIS IS WHAT
// STOPS THEM DISAGREEING.
//
// `applySkin` publishes every token the registry names as an INLINE style on
// <html>, which beats a `:root[data-skin=...]` rule at any specificity. So a
// skin whose CSS block says one thing and whose registry entry says another
// does not render "somewhere in between" — the registry wins silently and the
// CSS block becomes a lie that still reads as the source of truth.
//
// That is not hypothetical: measured on production 2026-08-19, Stardew's CSS
// declared a wooden header band while the registry said `rainbow: false`, and
// the band vanished from the live grid. Nothing failed; it just stopped
// painting. This test is the thing that would have failed.
//
// The bare `:root` rule is checked against the DEFAULT skin rather than skipped,
// because that rule is what a surface with no `data-skin` renders — a page
// preview iframe, or any frame before `applySkin`'s first effect. It is
// deliberately the retro look, and it has to STAY the retro look.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SKINS, getSkin, DEFAULT_SKIN } from "../helpers/skins";

const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "index.css"),
  "utf8",
);

/**
 * Canonicalise a token value so only a REAL difference fails.
 *
 * Whitespace is dropped entirely — the CSS gradient is authored over four lines
 * and the registry's over two, and neither is more correct. Numbers go through
 * `Number` so `0.30` and `0.3` are the same alpha rather than a false failure;
 * a test that cries wolf over formatting is one somebody deletes.
 */
const norm = (v) => {
  const flat = String(v).replace(/\s+/g, "");
  return flat !== "" && Number.isFinite(Number(flat)) ? String(Number(flat)) : flat;
};

/**
 * The declarations of the first rule whose selector list contains `selector`.
 * Deliberately naive — index.css has no nested at-rules around these blocks,
 * and a parser that silently matched the wrong rule would be worse than one
 * that throws.
 */
function tokensFor(selector) {
  const at = CSS.indexOf(selector);
  if (at === -1) return null;
  const open = CSS.indexOf("{", at);
  const close = CSS.indexOf("}", open);
  if (open === -1 || close === -1) return null;
  const body = CSS.slice(open + 1, close);
  const out = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = norm(m[2]);
  return out;
}

/** Registry → the exact value `applySkin` publishes for each token. */
function publishedBy(skin) {
  return {
    "--grid-surface-a": norm(skin.surfaceAlpha),
    "--grid-wallpaper": norm(skin.wallpaper ?? "none"),
    "--grid-wallpaper-scrim": norm(skin.wallpaperScrim ?? 1),
    "--retro-rainbow": norm(skin.band ?? "none"),
    "--retro-header-scrim": norm(skin.headerScrim ?? 1),
    "--retro-panel-scrim": norm(skin.panelScrim ?? 1),
  };
}

describe("the registry and the stylesheet agree, token for token", () => {
  for (const skin of SKINS) {
    const css = tokensFor(`:root[data-skin="${skin.id}"]`);
    // Blueprint ships with no token block at all — it is the skin that proves a
    // new look is a DATA edit. Nothing to compare, and that is the point.
    if (!css) continue;
    it(`${skin.id} declares the same tokens in CSS as it publishes from JS`, () => {
      const js = publishedBy(skin);
      for (const [name, cssValue] of Object.entries(css)) {
        if (!(name in js)) continue;   // fonts and per-skin extras are CSS-only
        expect(`${name}: ${cssValue}`).toBe(`${name}: ${js[name]}`);
      }
    });
  }

  // The bare `:root` still carries the default LOOK — wallpaper and scrims — so
  // an unstamped document reads as this app rather than a blank sheet.
  it("the bare :root default is still the default skin's look", () => {
    const bare = tokensFor(":root,\n:root[data-skin=\"retro-rainbow\"]");
    expect(bare).toBeTruthy();
    const js = publishedBy(getSkin(DEFAULT_SKIN));
    expect(bare["--grid-wallpaper"]).toBe(js["--grid-wallpaper"]);
    expect(bare["--grid-wallpaper-scrim"]).toBe(js["--grid-wallpaper-scrim"]);
  });

  // ...but NOT the rainbow band. It was in the bare `:root` until 2026-08-22,
  // which made it the default for every unstamped document — including the whole
  // of a cold load, before the grid's own skin is known. User, twice: *"dont let
  // the default header color be the rainbow either"* and *"that header color is
  // happening when the first grid loads, its a rainbow"*.
  it("the bare :root does NOT carry the rainbow band", () => {
    const bare = tokensFor(":root,\n:root[data-skin=\"retro-rainbow\"]");
    expect(bare["--retro-rainbow"]).toBeUndefined();
  });

  it("the retro skin still declares the band, and it matches the registry", () => {
    // Held back from the default is not the same as removed — the skin that IS
    // the rainbow must still get it, or the fix would delete the look.
    const skinOnly = tokensFor(":root[data-skin=\"retro-rainbow\"]");
    expect(skinOnly).toBeTruthy();
    const js = publishedBy(getSkin(DEFAULT_SKIN));
    expect(skinOnly["--retro-rainbow"]).toBe(js["--retro-rainbow"]);
  });
});
