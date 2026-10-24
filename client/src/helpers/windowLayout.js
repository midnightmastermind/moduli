// helpers/windowLayout.js — every window keeps its OWN layout (user, 2026-10-24: "turn off persisted layout between
// devices for all", so two windows on one grid can show different pages and things can be dragged between them).
//
// What counts as layout: the grid's shape (rows/cols/sizes, its split tree and rules), which panels it shows, the
// date filter, which page each panel shows, and each panel's own pages / place / visibility. Everything else (rows,
// fields, text …) is shared as always.
//
// How: a window still writes its layout to the server (so a device that has never opened the grid starts from the
// last layout anyone used), but it ignores other windows' layout changes as they arrive (helpers/localLayout), and on
// a reload it lays its own saved layout over what the server sends (`applyWindowLayout`). Saved per tab
// (sessionStorage, so a reload keeps THIS window's) and per device (localStorage, for a new tab).
//
// Pure apart from the storage it is handed; fails quiet (no storage = the server's layout).

export const GRID_LAYOUT_KEYS = ["rows", "cols", "colSizes", "rowSizes", "occurrences", "activeFilterValues", "activeFilterId"];
export const GRID_META_LAYOUT_KEYS = ["layoutTree", "layoutRules"];
export const PANEL_LAYOUT_KEYS = ["occurrences", "placement", "display"];

const keyFor = (gridId) => (gridId ? `moduli-layout:${gridId}` : null);

/** This window's layout, from the store's state. */
export function snapshotLayout({ grid, views, occurrencesById }) {
  if (!grid) return null;
  const g = {};
  for (const k of GRID_LAYOUT_KEYS) if (grid[k] !== undefined) g[k] = grid[k];
  const meta = {};
  for (const k of GRID_META_LAYOUT_KEYS) if (grid.meta?.[k] !== undefined) meta[k] = grid.meta[k];
  const panels = {};
  for (const id of grid.occurrences || []) {
    const occ = occurrencesById?.[id];
    if (!occ) continue;
    const p = {};
    for (const k of PANEL_LAYOUT_KEYS) if (occ[k] !== undefined) p[k] = occ[k];
    panels[id] = p;
  }
  const v = {};
  for (const view of views || []) if (view?.id && view.activeOccurrenceId) v[view.id] = view.activeOccurrenceId;
  return { grid: g, meta, panels, views: v };
}

export function saveWindowLayout(gridId, snap, { session = globalThis.sessionStorage, local = globalThis.localStorage } = {}) {
  const key = keyFor(gridId);
  if (!key || !snap) return;
  const json = JSON.stringify(snap);
  for (const s of [session, local]) { try { s?.setItem(key, json); } catch { /* quota / private mode */ } }
}

export function readWindowLayout(gridId, { session = globalThis.sessionStorage, local = globalThis.localStorage } = {}) {
  const key = keyFor(gridId);
  if (!key) return null;
  for (const s of [session, local]) {
    try { const raw = s?.getItem(key); if (raw) return JSON.parse(raw); } catch { /* ignore */ }
  }
  return null;
}

/**
 * A full_state payload with this window's saved layout laid over it. Only what still exists is restored: a panel
 * deleted elsewhere drops out of the panel list, a view the payload lacks is skipped, a page the payload does not
 * hold (yet) is not forced onto a view.
 */
export function applyWindowLayout(payload, snap) {
  if (!payload?.grid || !snap) return payload;
  const occs = payload.occurrences || [];
  const occIds = new Set(occs.map((o) => o?.id));
  const grid = { ...payload.grid };
  for (const k of GRID_LAYOUT_KEYS) {
    if (snap.grid?.[k] === undefined) continue;
    grid[k] = k === "occurrences" ? snap.grid.occurrences.filter((id) => occIds.has(id)) : snap.grid[k];
  }
  // A grid whose panel list came back empty keeps the server's (never show nothing because of a stale snapshot).
  if (Array.isArray(grid.occurrences) && grid.occurrences.length === 0) grid.occurrences = payload.grid.occurrences;
  if (snap.meta && Object.keys(snap.meta).length) {
    grid.meta = { ...(payload.grid.meta || {}) };
    for (const k of GRID_META_LAYOUT_KEYS) if (snap.meta[k] !== undefined) grid.meta[k] = snap.meta[k];
  }
  const panels = snap.panels || {};
  const occurrences = occs.map((o) => (o && panels[o.id] ? { ...o, ...panels[o.id] } : o));
  const views = (payload.views || []).map((v) => {
    const want = v && snap.views?.[v.id];
    return want && occIds.has(want) && want !== v.activeOccurrenceId ? { ...v, activeOccurrenceId: want } : v;
  });
  return { ...payload, grid, occurrences, views };
}

/** An incoming update to a PANEL occurrence, as this window takes it: its layout keys are this window's own. */
export function incomingPanelUpdate(occurrence, panelIds) {
  if (!occurrence?.id || !panelIds?.has?.(occurrence.id)) return occurrence;
  const out = { ...occurrence };
  for (const k of PANEL_LAYOUT_KEYS) delete out[k];
  return out;
}
