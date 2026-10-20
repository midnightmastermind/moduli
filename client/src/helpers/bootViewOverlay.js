// WHICH PAGE EACH PANEL SHOWS, kept beside the boot snapshot.
//
// The snapshot (helpers/bootSnapshot) is saved once, ~20s after a load. A page opened after that
// is not in it, so a reload drew the OLD page from the snapshot and the real full_state switched
// to the new one a second later (user: "the book opens but then switches to daypage a second
// later"). Every page change is written here (one small entry per view) and laid over the
// snapshot's views when it is drawn. The real full_state replaces everything anyway.
//
// Fails quiet: no localStorage means no overlay, never an error on the load path.
const keyFor = (gridId) => (gridId ? `moduli-boot-views:${gridId}` : null);

function read(gridId, storage) {
  const key = keyFor(gridId);
  if (!key || !storage) return {};
  try { const v = JSON.parse(storage.getItem(key) || "{}"); return v && typeof v === "object" ? v : {}; }
  catch { return {}; }
}

export function recordViewPage(gridId, viewId, activeOccurrenceId, storage = globalThis.localStorage) {
  const key = keyFor(gridId);
  if (!key || !viewId || !activeOccurrenceId || !storage) return;
  const map = read(gridId, storage);
  if (map[viewId] === activeOccurrenceId) return;
  map[viewId] = activeOccurrenceId;
  try { storage.setItem(key, JSON.stringify(map)); } catch { /* quota */ }
}

// A copy of the payload with each view's page taken from the overlay. Only views the payload
// holds are touched; an overlay entry for a page the payload lacks is skipped (it would render
// nothing).
export function applyViewOverlay(payload, storage = globalThis.localStorage) {
  if (!payload?.gridId || !Array.isArray(payload.views)) return payload;
  const map = read(payload.gridId, storage);
  const ids = Object.keys(map);
  if (!ids.length) return payload;
  const occIds = new Set((payload.occurrences || []).map((o) => o?.id));
  let changed = false;
  const views = payload.views.map((v) => {
    const want = v && map[v.id];
    if (!want || want === v.activeOccurrenceId || !occIds.has(want)) return v;
    changed = true;
    return { ...v, activeOccurrenceId: want };
  });
  return changed ? { ...payload, views } : payload;
}
