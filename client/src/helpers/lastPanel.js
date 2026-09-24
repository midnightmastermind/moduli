// helpers/lastPanel.js — the panel the user last clicked in.
//
// Grid's Ctrl+Alt+Arrow snap moves "the last-clicked panel", and the Command
// Center (which lives in no panel) opens things "where you were working" —
// one answer to one question, so it lives here rather than in Grid's ref.
// The value is the panel MODULE id (`data-panel-id`), or null before any click.

let lastPanelId = null;
let installs = 0;

const onDown = (e) => {
  const el = e.target?.closest?.("[data-panel-id]");
  if (el) lastPanelId = el.getAttribute("data-panel-id");
};

/** Start listening (capture phase, so an inner stopPropagation cannot hide a click). Returns the uninstall. */
export function trackLastPanel() {
  if (typeof document === "undefined") return () => {};
  if (installs++ === 0) document.addEventListener("pointerdown", onDown, true);
  return () => {
    if (--installs === 0) document.removeEventListener("pointerdown", onDown, true);
  };
}

export function getLastPanelId() {
  return lastPanelId;
}

/**
 * The panel OCCURRENCE to open something in: the last-clicked panel if it is
 * still on this grid, else the grid's first panel. null when the grid has none.
 */
export function pickPanelOccurrence({ grid, occurrencesById = {} }) {
  const panels = (grid?.occurrences || []).map((id) => occurrencesById[id]).filter(Boolean);
  const last = getLastPanelId();
  return panels.find((p) => p.moduleId === last) || panels[0] || null;
}

// test seam
export function _setLastPanelId(id) { lastPanelId = id; }
