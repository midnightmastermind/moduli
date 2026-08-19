// helpers/skins.js
//
// A SKIN is the grid's whole look, declared as DATA.
//
// This is a second axis to the five THEMES, not a replacement for them. A theme
// owns the ~71 surface / text / signal tokens; a skin owns the things a theme
// never covered — the wallpaper, the scrims over it, how opaque a surface is on
// top of it, the fonts, and what happens to colours stored in the DATA. Folding
// them together would mean re-authoring five themes to ship one wallpaper.
//
// WHY THIS FILE EXISTS AT ALL. Measured 2026-08-19: `--grid-wallpaper`,
// `--grid-wallpaper-scrim`, `--grid-surface-a`, `--retro-rainbow` and the two
// retro scrims lived in a BARE `:root` — outside every `[data-theme]` block. So
// they applied to all five themes at once and switching theme changed neither
// the wallpaper nor the rainbow. Naming the current look as a skin is what makes
// a second one possible.
//
// A skin may PIN a theme (`theme`). Without that, a light theme under a dark
// skin is reachable in two clicks and reads as broken.

import { STARDEW_PALETTE, BLUEPRINT_PALETTE } from "./skinPalettes";

export const DEFAULT_SKIN = "retro-rainbow";

export const SKINS = [
  // ── The five looks that existed before skins did ─────────────────────────
  // User, 2026-08-19: "make sure to include the first skins we had, light and
  // dark too." These are the original THEMES, each named as a skin with NO
  // wallpaper and NO rainbow — which is exactly how the app looked before
  // 2026-08-17 added both. Nothing is lost by the picker becoming the one
  // "what does my grid look like" control.
  //
  // `wallpaper: null` and `rainbow: false` are what a plain skin needs, and the
  // scrim goes to 1 with them: a translucent scrim over NO art is a wash over
  // the body colour, not the flat surface these looks are supposed to have.
  {
    id: "moduli-dark", label: "Moduli Dark", description: "Deep navy workspace",
    swatches: ["#0c1220", "#141e30", "#1e3a5f"],
    theme: "moduli-dark", wallpaper: null, rainbow: false, surfaceAlpha: 1, storedColorAlpha: 1, palette: null,
  },
  {
    id: "moduli-light", label: "Moduli Light", description: "Clean light workspace",
    swatches: ["#f7f8fa", "#e8ebf0", "#c9d2de"],
    theme: "moduli-light", wallpaper: null, rainbow: false, surfaceAlpha: 1, storedColorAlpha: 1, palette: null,
  },
  {
    id: "midnight", label: "Midnight", description: "Near-black, high contrast",
    swatches: ["#07090d", "#12151b", "#2a2f3a"],
    theme: "midnight", wallpaper: null, rainbow: false, surfaceAlpha: 1, storedColorAlpha: 1, palette: null,
  },
  {
    id: "vintage-light", label: "Vintage Light", description: "70s cream paper, rust ink",
    swatches: ["#ece3d0", "#b34f24", "#3e8e7e"],
    theme: "vintage-light", wallpaper: null, rainbow: false, surfaceAlpha: 1, storedColorAlpha: 1, palette: null,
  },
  {
    id: "vintage-dark", label: "Vintage Dark", description: "70s dark brown, cream ink",
    swatches: ["#2b211d", "#e0a63f", "#3e8e7e"],
    theme: "vintage-dark", wallpaper: null, rainbow: false, surfaceAlpha: 1, storedColorAlpha: 1, palette: null,
  },

  // ── Today's look, named ──────────────────────────────────────────────────
  {
    id: "retro-rainbow",
    label: "Retro Rainbow",
    description: "The 70s rainbow band over the ray wallpaper",
    swatches: ["#e5453a", "#f5c542", "#3b7dd8"],
    // Deliberately NO theme pin: the rainbow has always read under whichever
    // theme was chosen, and pinning one here would silently change the look of
    // a grid that is already using it.
    theme: null,
    wallpaper: 'url("/grid-wallpaper.jpg")',
    rainbow: true,
    wallpaperScrim: 0.62,
    headerScrim: 0.45,
    panelScrim: 0.45,
    // Two alphas, not one — see the Stardew skin below for why they had to be
    // split. Here they are the same number, which is today's behaviour exactly.
    surfaceAlpha: 0.24,
    storedColorAlpha: 0.24,
    palette: null,
  },

  // ── Stardew Valley ───────────────────────────────────────────────────────
  {
    id: "stardew",
    label: "Stardew Valley",
    description: "Pixel-art mountains, wooden panels, dark ink",
    swatches: ["#3fa9f5", "#4cc93f", "#2e7d32"],
    // Stardew's UI is dark ink on cream inside a wooden frame — a LIGHT theme.
    // Pinned, because the whole look collapses under a dark one.
    theme: "stardew",
    wallpaper: 'url("/stardew-wallpaper.webp")',
    rainbow: false,
    // SEMI-TRANSPARENT, LIKE THE RETRO SKIN (user, 2026-08-19: "i still cant
    // see that background … every occurance background should be semi
    // transparent like we had on our rainbow theme").
    //
    // THIS REVERSES MY OWN REASONING, and the reversal is the point. I argued
    // that Stardew's panels are solid wood so the art should read in the
    // GUTTERS — which is faithful to the game and, measured, meant the
    // wallpaper covered ~2% of what you look at. The user wants the workspace
    // to show its background, and that is a product call, not a fidelity one.
    //
    // The scrim goes UP as the surfaces come down: with translucent panels the
    // art is behind the TEXT rather than beside it, so it needs dimming to give
    // the ink its background back. That is the same knob, in the same
    // direction, that CLAUDE.md 2026-08-17 records as the one to turn.
    // SEMI-TRANSPARENT, LIKE THE RETRO SKIN (user, 2026-08-19: "i still cant
    // see that background … every occurance background should be semi
    // transparent like we had on our rainbow theme").
    //
    // THIS REVERSES MY OWN REASONING, and the reversal is worth keeping. I
    // argued that Stardew's panels are solid wood so the art should read in the
    // GUTTERS — faithful to the game, and measured, it meant the wallpaper
    // covered about 2% of what you look at. Whether the workspace shows its
    // background is a product call, not a fidelity one.
    //
    // The scrim goes UP as the surfaces come down: with translucent panels the
    // art sits behind the TEXT rather than beside it, so it needs dimming to
    // give the ink its background back. Same knob, same direction, as
    // CLAUDE.md 2026-08-17 records.
    wallpaperScrim: 0.52,
    headerScrim: 0.55,
    panelScrim: 0.55,
    surfaceAlpha: 0.30,
    // Above the surface alpha — a card carrying a colour should read as
    // carrying one — but well under opaque, so the wallpaper reaches through.
    storedColorAlpha: 0.42,
    palette: STARDEW_PALETTE,
  },

  // ── Blueprint ────────────────────────────────────────────────────────────
  // A custom skin for a second grid (user, 2026-08-19: "on the claude grid,
  // change up the theme … custom"), and deliberately the one that proves the
  // system takes more than a picture: its wallpaper is a GENERATED CSS pattern,
  // not a file. `--grid-wallpaper` is spliced into a `background-image` list, so
  // any value that property accepts works — a gradient costs no bytes, scales to
  // any viewport without cropping, and cannot be the wrong aspect ratio.
  //
  // It PINS the dark theme rather than shipping a sixth 71-token block: the
  // navy-and-cyan look this wants is what `moduli-dark` already is. A skin only
  // needs its own theme when no existing one is close, which was true of
  // Stardew's parchment and is not true here.
  {
    id: "blueprint",
    label: "Blueprint",
    description: "Drafting paper — navy ground, cyan rule, no photo",
    swatches: ["#0b1a2b", "#1e4a6d", "#5bc8f5"],
    theme: "moduli-dark",
    // Two grids of lines, coarse over fine, the way drafting paper is ruled.
    wallpaper: 'repeating-linear-gradient(0deg, rgba(91,200,245,0.16) 0 1px, transparent 1px 88px), ' +
               'repeating-linear-gradient(90deg, rgba(91,200,245,0.16) 0 1px, transparent 1px 88px), ' +
               'repeating-linear-gradient(0deg, rgba(91,200,245,0.07) 0 1px, transparent 1px 22px), ' +
               'repeating-linear-gradient(90deg, rgba(91,200,245,0.07) 0 1px, transparent 1px 22px)',
    rainbow: false,
    // The rule is the point, so almost nothing sits over it: a low scrim, and
    // surfaces translucent enough to read the grid through them.
    wallpaperScrim: 0.30,
    headerScrim: 0.55,
    panelScrim: 0.55,
    surfaceAlpha: 0.34,
    storedColorAlpha: 0.40,
    palette: BLUEPRINT_PALETTE,
  },
];

export function getSkin(id) {
  return SKINS.find(s => s.id === id) || SKINS.find(s => s.id === DEFAULT_SKIN);
}

/**
 * Which skin a grid renders in.
 *
 * Per GRID (user, 2026-08-19), falling back to the account-wide pick so an
 * existing choice still applies to any grid that has not named one, and finally
 * to the default so a grid with neither is exactly what it is today.
 */
export function resolveSkinId(grid, storedPreference) {
  return grid?.meta?.skin || storedPreference || DEFAULT_SKIN;
}
