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
//   1. `data-skin` on <html>  — the CSS half (the fonts, and the per-skin rules)
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
import { getSkin, resolveSkinId, DEFAULT_SKIN } from "../helpers/skins";
import { setActiveSkin, setThemeInk } from "../helpers/StyleHelpers";

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
  // EVERY VALUE THE SKIN DECLARES IS PUBLISHED FROM HERE, not just the alpha.
  //
  // It used to publish only `--grid-surface-a` and leave the wallpaper, the
  // scrims and the rainbow to a `:root[data-skin=...]` CSS block. That made the
  // registry's `wallpaper` / `wallpaperScrim` / `headerScrim` / `panelScrim` /
  // `rainbow` fields INERT — nothing read them — and a skin added without a
  // matching CSS block silently inherited the default look. Caught the first
  // time a skin was added as pure data: Blueprint applied, and the retro
  // rainbow kept painting.
  //
  // Publishing them means a new skin is a DATA edit and the two halves cannot
  // disagree, which is the whole reason the alpha was centralised in the first
  // place. `null` clears the property so the stylesheet's own value stands.
  const put = (name, value) => {
    if (value == null) el.style.removeProperty(name);
    else el.style.setProperty(name, String(value));
  };
  put("--grid-surface-a", skin.surfaceAlpha);
  put("--grid-wallpaper", skin.wallpaper ?? "none");
  put("--grid-wallpaper-scrim", skin.wallpaperScrim ?? 1);
  // THE BAND IS A VALUE, and it had to become one. This published
  // `skin.rainbow ? null : "none"` for a few hours, which read a boolean where
  // three states exist: retro's rainbow, Stardew's wooden frame, and no band at
  // all. Stardew declares `rainbow: false` and yet HAS a band — so `none` went
  // out inline over the wood gradient its own CSS block declares, and an inline
  // style on <html> beats a stylesheet rule whatever its specificity. The band
  // vanished from the live grid. A value has no such gap.
  put("--retro-rainbow", skin.band ?? "none");
  put("--retro-header-scrim", skin.headerScrim ?? 1);
  put("--retro-panel-scrim", skin.panelScrim ?? 1);
  setActiveSkin(skin);

  // THE THEME'S INK AND PAGE, READ AFTER `data-theme` IS ON THE ELEMENT.
  // Order matters: these are resolved custom properties, so reading them before
  // the attribute is set returns the PREVIOUS theme's values — which is a
  // silent, plausible-looking wrong answer rather than an error.
  //
  // This is what lets `styleToCSS` tell a readable stored colour from an
  // unreadable one. It is published from here for the same reason every other
  // skin value is: one place, so the halves cannot drift.
  try {
    const cs = getComputedStyle(el);
    const ink = cs.getPropertyValue("--text-primary").trim();
    const page = cs.getPropertyValue("--body-bg").trim();
    setThemeInk(ink && page ? { ink, page } : null);
  } catch {
    // No computed style (SSR, a detached document). Null means "do nothing",
    // which is the behaviour that existed before this — never a guess.
    setThemeInk(null);
  }
}

/**
 * @param grid  the live grid record (`grid.meta.skin` is the per-grid choice)
 */
export function useSkin(grid) {
  const stored = readStoredSkin();
  // NOTHING IS APPLIED UNTIL THERE IS SOMETHING TO RESOLVE FROM.
  //
  // This hook runs on the FIRST render, when `grid` is still null — `full_state`
  // has not arrived. `resolveSkinId(null, null)` falls through to DEFAULT_SKIN,
  // which IS `retro-rainbow`, so the document was stamped with the rainbow for
  // the whole length of the load and every cold start opened on a rainbow header
  // before the grid's real skin replaced it. Reported 2026-08-22: *"that header
  // color is happening when the first grid loads, its a rainbow"* — and it is
  // the same complaint as 2026-08-19's *"dont let the default header color be
  // the rainbow either"*, which the skin system answered for a grid that NAMES a
  // skin and not for the moment before one is known.
  //
  // An unstamped document is the right neutral by construction: `--retro-rainbow`
  // is declared only inside `:root[data-skin="retro-rainbow"]`, so with no
  // attribute the var is undefined, `background: var(--retro-rainbow)` is an
  // invalid declaration, and the band simply does not paint. No new "loading"
  // skin, and no flash of one look before another.
  //
  // The account-wide stored pick is still honoured pre-grid — it is a real
  // answer, just not a grid-specific one, and using it is what keeps a returning
  // user from seeing any transition at all.
  const skinId = grid ? resolveSkinId(grid, stored) : (stored || null);
  useEffect(() => {
    if (!skinId) return;
    applySkin(getSkin(skinId));
  }, [skinId]);
  // Callers still get a concrete skin to read from; only the DOM waits.
  const resolved = skinId || DEFAULT_SKIN;
  return { skinId: resolved, skin: getSkin(resolved) };
}
