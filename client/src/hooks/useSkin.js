// hooks/useSkin.js
//
// Which skin the CURRENT GRID renders in, and everything that has to move when
// it changes.
//
// User, 2026-08-19: *"change my main grid to use the background"* — per GRID,
// which the previous mechanism could not express: `useTheme` reads and writes
// `localStorage["moduli-theme"]`, so a pick restyled every grid on the machine
// and did not follow the user to another device.
//
// FOUR THINGS MOVE TOGETHER, and they must move in ONE place or they drift:
//
//   1. `data-skin` on <html>  — the CSS half (wallpaper, scrims, rainbow, fonts)
//   2. `data-theme` on <html> — pinned by skins that declare one, because a
//      light theme under a dark skin is two clicks away and reads as broken
//   3. `--grid-surface-a`     — App already published SURFACE_ALPHA here; the
//      skin's value has to win, or a Stardew grid keeps retro's glass panels
//   4. `setActiveSkin`        — the JS half, so `styleToCSS` can re-render the
//      424 colours stored in the data, which no stylesheet can reach
//
// (3) and (4) are the same number and the same object on purpose: the CSS half
// and the stored-colour half being one source is the whole reason SURFACE_ALPHA
// was centralised in 2026-08-17.
import { useEffect } from "react";
import { getSkin, resolveSkinId } from "../helpers/skins";
import { setActiveSkin } from "../helpers/StyleHelpers";

const STORAGE_KEY = "moduli-skin";

export function readStoredSkin() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
export function writeStoredSkin(id) {
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* storage denied */ }
}

/** Apply a skin to the document. Exported so a preview surface can call it. */
export function applySkin(skin) {
  const el = document.documentElement;
  el.setAttribute("data-skin", skin.id);
  if (skin.theme) {
    el.setAttribute("data-theme", skin.theme);
    // The `dark` class is what Tailwind's dark: variants read, and it is set
    // alongside data-theme everywhere else. A skin that pins a LIGHT theme has
    // to clear it or half the app stays in dark mode.
    const dark = !/light|stardew/.test(skin.theme);
    el.classList.toggle("dark", dark);
  }
  el.style.setProperty("--grid-surface-a", String(skin.surfaceAlpha));
  setActiveSkin(skin);
}

/**
 * @param grid  the live grid record (`grid.meta.skin` is the per-grid choice)
 */
export function useSkin(grid) {
  const skinId = resolveSkinId(grid, readStoredSkin());
  useEffect(() => {
    applySkin(getSkin(skinId));
  }, [skinId]);
  return { skinId, skin: getSkin(skinId) };
}
