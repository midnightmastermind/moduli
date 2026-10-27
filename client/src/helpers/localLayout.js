// helpers/localLayout.js — every window keeps its own layout.
//
// Which page each panel shows, the grid's split layout and its date filter are LAYOUT. Since 2026-10-24 (user: "turn
// off persisted layout between devices for all") every window keeps its own: it still SENDS its layout writes (the
// server's copy is what a device that has never opened the grid starts from), but it IGNORES other windows' layout
// changes as they arrive, and on a reload it restores its own saved layout (helpers/windowLayout). Before, this was
// a mode only the VR office switched on, and it DROPPED the writes — which also lost anything riding in the same
// update_grid (a rename, field presets).
//
// Layout writes:
//   update_view                      the page a panel shows, its tree toggles
//   update_grid                      split layout, rows/cols, date filter, grid meta
//   update_occurrence on a PANEL     the pages a panel holds

const KEY = "moduli-local-layout";
// Always on (see the header). Kept as a value so the tests and the VR office can still ask.
let on = true;
let panelIdsGetter = () => null;
const listeners = new Set();

void KEY;

export function isLocalLayout() { return on; }

export function setLocalLayout(next) {
  on = !!next;
  for (const fn of listeners) fn(on);
}

export function subscribeLocalLayout(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** App tells this module which occurrence ids are panels (a getter, read at write time). */
export function setPanelIdsGetter(fn) { panelIdsGetter = typeof fn === "function" ? fn : () => null; }

export function isLayoutWrite(event, data) {
  if (event === "update_view" || event === "update_grid") return true;
  if (event === "update_occurrence") {
    const id = data?.occurrence?.id;
    const panels = panelIdsGetter();
    return !!(id && panels && panels.has(id));
  }
  return false;
}

/** The occurrence ids that are panels on this grid (read at call time), or null. */
export function currentPanelIds() { return panelIdsGetter(); }

/** A window inside the headset app (the grid screen, readers, the control panel): it has the native bridge. */
export function isHeadsetWindow() {
  return typeof window !== "undefined" && !!window.ModuliNative;
}

/**
 * True when this write must stay in this tab. A desktop window's layout writes go to the server as the default for
 * new devices (other windows ignore them as they arrive). A HEADSET window lays the grid out for its own small screen,
 * and that must never become the default (user, 2026-10-27: the desktop's 2-column layout kept turning into a 2x2
 * grid — the headset's grid screen had written its own). So there the panels' pages stay local, and its grid writes
 * carry `keepLayout` (offlineQueue) so the server keeps its stored layout and takes only the rest.
 */
export function keepLocal(event, data) {
  if (!isHeadsetWindow()) return false;
  return event === "update_view" || (event === "update_occurrence" && isLayoutWrite(event, data));
}

// ── Incoming: another device's layout must not reshape this one either ──────
// `occurrences` is the grid's panel list: which panels a device shows is part of its layout, so a panel added or
// removed on another device does not appear or vanish here (user, 2026-10-26).
const LAYOUT_GRID_KEYS = ["rows", "cols", "colSizes", "rowSizes", "occurrences", "activeFilterValues", "activeFilterId"];
const LAYOUT_META_KEYS = ["layoutTree", "layoutRules"];

/**
 * A grid patch from the server, as this tab should take it while local: the
 * layout keys dropped, and a whole-meta patch keeping this tab's own layout
 * entries. Returns the patch unchanged when the mode is off.
 */
export function incomingGridPatch(patch, currentMeta) {
  if (!on || !patch) return patch;
  const out = { ...patch };
  for (const k of LAYOUT_GRID_KEYS) delete out[k];
  if (out.meta && typeof out.meta === "object") {
    const meta = { ...out.meta };
    for (const k of LAYOUT_META_KEYS) {
      if (currentMeta && k in currentMeta) meta[k] = currentMeta[k];
      else delete meta[k];
    }
    out.meta = meta;
  }
  return out;
}
