// helpers/targetPanelMenu.js
//
// The right-click items that set the sticky open target.
//
// User, 2026-08-23: *"i should be able to set in the right click menu, a panel
// ... and it should be set as that until i turn it off. so when i double click
// then on the bookmark, it opens in the panel i selected."*
//
// SETTING AND OPENING ARE DIFFERENT GESTURES, and this only does the first. The
// menu chooses where bookmarks go from now on; the double-click is what opens
// one. Making the menu also open would collapse "configure" into "act", and
// there would be no way to change the destination without also navigating.
//
// PURE, because the interesting part is what the list CONTAINS: which panel is
// ticked, whether Clear is offered, and what happens with one panel or none.

/**
 * @param {object} args
 *   panels     [{ id, label }]  panels that exist right now
 *   currentId  the sticky target, or null
 * @returns [{ id, label, checked, clears }]  — `clears` marks the Clear entry
 *
 * `Clear` is offered ONLY when something is set. An always-present "Clear" on a
 * feature that is off by default is a control that does nothing, which is the
 * class this repo keeps removing.
 */
export function targetPanelMenuItems({ panels = [], currentId = null } = {}) {
  const items = panels
    .filter((p) => p && p.id)
    .map((p) => ({
      id: p.id,
      label: p.label || "Untitled panel",
      checked: p.id === currentId,
      clears: false,
    }));
  const known = items.some((i) => i.checked);
  // A target pointing at a panel that no longer exists still needs a way OUT,
  // or the setting is unreachable and silently keeps failing over.
  if (currentId) items.push({ id: null, label: known ? "Clear" : "Clear (panel is gone)", checked: false, clears: true });
  return items;
}

/** Should the picker be offered at all? */
export function shouldOfferTargetPicker(panels) {
  // With a single panel there is nowhere else to send anything, and the setting
  // would only ever restate the default.
  return Array.isArray(panels) && panels.length > 1;
}
