// helpers/targetPanel.js
//
// The sticky panel that opened pages go to.
//
// User, 2026-08-23: *"i should be able to set in the right click menu, a panel
// ... and it should be set as that until i turn it off. so when i double click
// then on the bookmark, it opens in the panel i selected. if none is selected,
// we open in the panel we are opening it from."*
//
// GRID-WIDE, not per row. Setting it per bookmark would mean 1,467 places to
// change your mind.
//
// UNSET IS THE DEFAULT AND IT IS INVISIBLE: with no target, a double-click opens
// where it was clicked. Picking a target is how you say "no, over there", so the
// feature costs nothing until it is wanted.
//
// A STALE TARGET FALLS BACK TO THE SAME RULE. If the chosen panel is gone the
// click opens where it was made, rather than failing — the setting quietly stops
// applying instead of swallowing the gesture. It deliberately does NOT re-open a
// closed panel: changing the layout as a side effect of a double-click is a
// surprise, and the click still has somewhere obvious to land.

export const TARGET_PANEL_KEY = "iframeTargetPanelId";

/** The configured target, or null. */
export function getTargetPanelId(grid) {
  const v = grid?.meta?.[TARGET_PANEL_KEY];
  return typeof v === "string" && v ? v : null;
}

/**
 * Which panel a double-click should open in.
 *
 * @param {object}   grid
 * @param {string}   fromPanelOccId  the panel the gesture happened in
 * @param {Set|Array} livePanelIds   panels that exist right now
 * @returns {{ panelId: string|null, via: "target"|"here"|"stale" }}
 *
 * `via` is reported because the caller sometimes wants to say so — "that panel
 * is gone" is worth a word, while the ordinary case deserves silence.
 */
export function resolveOpenTarget(grid, fromPanelOccId, livePanelIds) {
  const live = livePanelIds instanceof Set ? livePanelIds : new Set(livePanelIds || []);
  const target = getTargetPanelId(grid);
  if (target && live.has(target)) return { panelId: target, via: "target" };
  if (target) return { panelId: fromPanelOccId || null, via: "stale" };
  return { panelId: fromPanelOccId || null, via: "here" };
}

/** The `grid.meta` patch that sets or clears the target. */
export function targetPanelPatch(grid, panelOccId) {
  return { meta: { ...(grid?.meta || {}), [TARGET_PANEL_KEY]: panelOccId || null } };
}
