// helpers/localLayout.js — "this device only" layout.
//
// Which page each panel shows, the grid's split layout and its date filter are
// SHARED: every device reads them from the server. The VR office runs inside a
// headset's browser tab, and opening a book from it, or the headset's own
// screen size reshaping the mosaic, would move panels on the desktop too (user,
// 2026-10-21: "make sure the grid opening up on a screen does not affect the
// layout for other devices").
//
// While this mode is on, those writes apply in THIS tab only: `safeEmit` drops
// them before they reach the server (the local dispatch has already happened).
// It lasts for the tab's session (sessionStorage), so a reload inside the
// office keeps it; "Sync layout" turns it off and reloads the shared layout.
//
// Layout writes:
//   update_view                      the page a panel shows, its tree toggles
//   update_grid                      split layout, rows/cols, date filter, grid meta
//   update_occurrence on a PANEL     the pages a panel holds
// The office's own settings do NOT go through update_grid — they have their own
// route that writes `meta.vrOffice` alone (PUT /api/v1/vr/office).

const KEY = "moduli-local-layout";
let on = false;
let panelIdsGetter = () => null;
const listeners = new Set();

try { on = sessionStorage.getItem(KEY) === "1"; } catch { /* private mode */ }

export function isLocalLayout() { return on; }

export function setLocalLayout(next) {
  on = !!next;
  try { if (on) sessionStorage.setItem(KEY, "1"); else sessionStorage.removeItem(KEY); } catch { /* ignore */ }
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

/** True when this write must stay in this tab. */
export function keepLocal(event, data) { return on && isLayoutWrite(event, data); }

// ── Incoming: another device's layout must not reshape this one either ──────
const LAYOUT_GRID_KEYS = ["rows", "cols", "colSizes", "rowSizes", "activeFilterValues", "activeFilterId"];
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
