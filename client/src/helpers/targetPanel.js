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

// ── WHICH PANELS EXIST, and which one am I in ──────────────────────────────
//
// Both callers need the same two answers: the card that OPENS a bookmark (to
// find its fallback panel) and the menu that SETS the target (to list the
// choices). They were the same walk written twice, which is how the two drift
// into disagreeing about what counts as a panel.
//
// Kept here rather than in either caller because this module already owns the
// question "which panel", and neither caller owns the other.

/** Every panel occurrence on the grid, keyed by occurrence id. */
export function collectPanelOccurrences(occurrencesById = {}, modulesById = {}) {
  const out = {};
  for (const o of Object.values(occurrencesById || {})) {
    if (o?.id && modulesById?.[o.moduleId]?.role === "panel") out[o.id] = o;
  }
  return out;
}

/**
 * The panel an occurrence sits inside, by walking up `parentId`.
 *
 * DEPTH-CAPPED at 40: a cycle in the parent chain would otherwise hang the
 * click, and this grid has had a self-parented occurrence twice (2026-07-30's
 * board that became its own child). A miss returns null, which the caller reads
 * as "no fallback panel" rather than as an error.
 */
export function enclosingPanelId(occId, occurrencesById = {}, panelsById = {}) {
  let cursor = occurrencesById?.[occId];
  for (let i = 0; i < 40 && cursor; i++) {
    if (panelsById[cursor.id]) return cursor.id;
    cursor = occurrencesById[cursor.parentId];
  }
  return null;
}

/**
 * The panels a picker should list: `{ id, label }`, in the grid's own order.
 *
 * ORDER COMES FROM `grid.occurrences`, not from object iteration — a menu whose
 * rows reshuffle between two right-clicks is one nobody can build muscle memory
 * for. Panels the grid does not list are appended, so a panel that exists is
 * never unreachable.
 */
export function panelChoices(grid, panelsById = {}, modulesById = {}) {
  const listed = Array.isArray(grid?.occurrences) ? grid.occurrences : [];
  const seen = new Set();
  const out = [];
  const push = (id) => {
    const occ = panelsById[id];
    if (!occ || seen.has(id)) return;
    seen.add(id);
    out.push({ id, label: occ.label || modulesById?.[occ.moduleId]?.label || "" });
  };
  listed.forEach(push);
  Object.keys(panelsById).forEach(push);
  return out;
}
