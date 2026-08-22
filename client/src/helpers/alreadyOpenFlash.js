// helpers/alreadyOpenFlash.js
//
// "If i open a page in a panel, and its already opened in another visible
// panel, highlight the page in the spot thats opened (still open the page in
// the original spot)" — the parenthetical is the important half: this is a
// heads-up, never a block. The page still opens where it was asked for.
//
// The notifier itself has existed in `ModulePanel.openPage` since it was
// written; what it flashed was the whole PANEL SHELL. The user asked for the
// page's TAB instead — and there is no tab strip: a panel shows ONE page at a
// time, its name in `.page-header`, with the other pinned pages reached through
// the tree. So the closest honest target is that header row: it is small, it is
// precise, and it is literally the page in the spot that is open.
//
// Kept out of the component because a DOM reach-around is exactly the thing
// that is hard to test through a mounted panel, and the choice of element is
// the part that can silently regress.

/**
 * The element to flash inside an already-open panel.
 * Prefers the page header; falls back to the panel shell when a panel has no
 * page mounted, so the notice never silently does nothing.
 */
export function alreadyOpenFlashTarget(panelEl) {
  if (!panelEl || typeof panelEl.querySelector !== "function") return null;
  return panelEl.querySelector(".page-header") || panelEl;
}

/**
 * Restart the flash animation on `el`. The reflow read is load-bearing: adding
 * a class that is already present does not re-run its animation, so opening the
 * same page twice in a row would flash once.
 */
export function flashAlreadyOpen(el) {
  if (!el?.classList) return false;
  el.classList.remove("already-open-flash");
  void el.offsetWidth;                    // force reflow to restart the animation
  el.classList.add("already-open-flash");
  el.addEventListener("animationend", () => el.classList.remove("already-open-flash"), { once: true });
  return true;
}

/** Resolve + flash in one call. Returns the element flashed, or null. */
export function flashPanelAlreadyOpen(panelEl) {
  const target = alreadyOpenFlashTarget(panelEl);
  return target && flashAlreadyOpen(target) ? target : null;
}
