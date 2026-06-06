// helpers/currentLocation.js
//
// A tiny shared singleton holding the user's CURRENT LOCATION — the
// page/folder they most recently opened. The assistant drawer reads this at
// send-time so phrases like "here" / "this folder" / "this page" resolve to a
// real id WITHOUT the user spelling it out (the chat only sends gridId).
//
// Single source of truth, no prop-threading: ModulePanel.openPage() writes it
// (it already resolves the occurrence + module + folder maps), AssistantDrawer
// reads it via getCurrentLocation(). Subscribers (the drawer's location chip)
// get notified so the "looking at X" badge stays live.

let _location = null; // { id, label, type: "page" | "folder" }
const _subs = new Set();

export function setCurrentLocation(loc) {
  // Ignore no-op writes so we don't churn subscribers on every re-render.
  if (loc?.id === _location?.id && loc?.label === _location?.label && loc?.type === _location?.type) return;
  _location = loc && loc.id ? { id: loc.id, label: loc.label || loc.id, type: loc.type || "page" } : null;
  for (const fn of _subs) { try { fn(_location); } catch { /* subscriber threw — ignore */ } }
}

export function getCurrentLocation() {
  return _location;
}

export function subscribeCurrentLocation(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}
