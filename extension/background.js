// extension/background.js
//
// The service worker: register the menu, and turn a click into one POST to
// /api/v1/share.
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
  // The outcome is ALSO logged, so it can be read in the extension's console
  // (about:debugging → Inspect) even when notifications are off at the OS
  // level — a clip that says nothing anywhere cannot be diagnosed.
  console.log(`[moduli] ${message}`);
  // Notifications are optional — the permission may be declined, and a clip
  // that worked must not fail because we could not announce it.
  //
  // `create` returns a PROMISE in Firefox, so a rejection escapes a plain
  // try/catch. That is how a missing `icon128.png` hid every outcome: the
  // icon did not exist, every notification was refused, and nothing said so.
  try {
    const p = api.notifications?.create({
      type: "basic", iconUrl: "icon128.png", title: "Moduli", message,
    });
    p?.catch?.((e) => console.warn("[moduli] notification not shown:", e?.message || e));
  } catch (e) { console.warn("[moduli] notification not shown:", e?.message || e); }
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

  // Through the SHARE RULES (D15), not straight to /ingest — so a clip and a
  // phone share of the same link obey the same rules. The record still rides
  // along as `clip`: the grid's catch-all writes it exactly as /ingest did, so
  // day one is unchanged, and a `link` rule you write can take over.
  try {
    const res = await fetch(`${baseUrl}/api/v1/share`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        gridId, source: "extension",
        url: record.moduleFileRef, shape: record.meta?.clipShape, title: tab?.title || null,
        text: info.selectionText || null,
        // So a shared calendar is read in YOUR zone; the server remembers it
        // for senders that cannot say (curl, Windows "open with").
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        clip: record,
      }),
    });
    const body = await res.json().catch(() => ({}));
    notify(clipOutcomeMessage(res.ok ? body : { ok: false, error: body.message || body.error || `HTTP ${res.status}` }));
  } catch (e) {
    notify(`Clip failed: ${e?.message || "could not reach Moduli"}`);
  }
});
