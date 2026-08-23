// extension/background.js
//
// The service worker: register the menu, and turn a click into one POST.
//
// It is DELIBERATELY THIN. Every decision it could get wrong lives in
// `clip.js` and `settings.js`, which are pure and tested, because an MV3
// worker cannot be exercised in this repo's test environment. What is left
// here is registration, storage, fetch and a notification — the parts a person
// verifies by installing it.
import { CLIP_MENUS, buildClipRecord } from "./clip.js";
import { validateSettings, fieldIdsFrom, clipOutcomeMessage, SETTINGS_KEYS } from "./settings.js";

const api = globalThis.browser ?? globalThis.chrome;

// Menus are registered on install AND on startup: MV3 workers are killed when
// idle, and `onInstalled` does not fire again when one is revived.
const registerMenus = () => {
  api.contextMenus.removeAll(() => {
    for (const m of CLIP_MENUS) api.contextMenus.create(m);
  });
};
api.runtime.onInstalled.addListener(registerMenus);
api.runtime.onStartup?.addListener(registerMenus);

const notify = (message) => {
  // Notifications are optional — the permission may be declined, and a clip
  // that worked must not fail because we could not announce it.
  try {
    api.notifications?.create({
      type: "basic", iconUrl: "icon128.png", title: "Moduli", message,
    });
  } catch { /* the clip already landed; saying so is best-effort */ }
};

// The field table changes rarely and costs a round trip, so it is cached for
// the worker's life. A worker restart re-fetches it, which is the right cadence:
// long enough to not matter, short enough that a new field is picked up.
let fieldCache = null;

async function fieldIdsFor({ baseUrl, token, gridId }) {
  if (fieldCache) return fieldCache;
  const res = await fetch(`${baseUrl}/api/v1/fields?gridId=${encodeURIComponent(gridId)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return {};
  const body = await res.json().catch(() => ({}));
  fieldCache = fieldIdsFrom(body.fields || body.data || body);
  return fieldCache;
}

api.contextMenus.onClicked.addListener(async (info, tab) => {
  const stored = await api.storage.sync.get(SETTINGS_KEYS);
  const check = validateSettings(stored);
  if (!check.ok) { notify(check.message); return; }
  const { baseUrl, token, gridId, parentId } = check.settings;

  let fieldIds = {};
  try { fieldIds = await fieldIdsFor({ baseUrl, token, gridId }); } catch { /* clip without fields */ }

  const record = buildClipRecord({ info, tab: tab || {}, fieldIds, parentId });
  // `null` means the click carried no URL at all — nothing to be idempotent on.
  if (!record) { notify("Nothing to clip here — no address on that item."); return; }

  try {
    const res = await fetch(`${baseUrl}/api/v1/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ gridId, source: "clip", records: [record] }),
    });
    const body = await res.json().catch(() => ({}));
    notify(clipOutcomeMessage(res.ok ? body : { ok: false, error: body.error || `HTTP ${res.status}` }));
  } catch (e) {
    notify(`Clip failed: ${e?.message || "could not reach Moduli"}`);
  }
});
