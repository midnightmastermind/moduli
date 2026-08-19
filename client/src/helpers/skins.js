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

import { STARDEW_PALETTE } from "./skinPalettes";

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
    // STARDEW PANELS ARE SOLID WOOD, NOT GLASS. The retro skin keeps surfaces
    // near-transparent so the wallpaper reads THROUGH them; that is wrong here —
    // the game's panels are opaque, and translucent cards would put 11px text
    // over a sky. The art reads in the GUTTERS between panels instead, which is
    // also how the game frames its own UI.
    wallpaperScrim: 0.22,
    headerScrim: 0.92,
    panelScrim: 0.92,
    surfaceAlpha: 0.94,
    // AND THE STORED COLOURS STAY TRANSLUCENT, which is the opposite number and
    // is why these had to be two fields rather than one.
    //
    // The first version used `surfaceAlpha` for both. Looked at on poms grid,
    // which carries 424 stored colours: "Physical" is an opaque orange slab,
    // "Nutrition" inside it is another, and the rows inside that are orange
    // again — three nested fills at 0.94 make an orange wall, and the theme's
    // dark-brown ink on top of it is barely readable.
    //
    // What the SKIN wants opaque is its own cream panel. What a stored colour
    // means is "this row belongs to the Physical dimension" — an accent, not a
    // surface. At 0.28 it reads as a wash over the cream, the nine dimensions
    // stay distinguishable, and the ink keeps its background.
    storedColorAlpha: 0.28,
    palette: STARDEW_PALETTE,
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
