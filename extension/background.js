// extension/background.js
//
// The service worker: register the menu, and turn a click into one POST to
// /api/v1/share — or, for a "choose…" item, into a staged clip and the
// placement window opened on it.
//
// It is DELIBERATELY THIN. Every decision it could get wrong lives in
// `clip.js` and `settings.js`, which are pure and tested, because an MV3
// worker cannot be exercised in this repo's test environment. What is left
// here is registration, storage, fetch and a notification — the parts a person
// verifies by installing it.
import { CLIP_MENUS, buildClipRecord, isChooseMenu } from "./clip.js";
import { validateSettings, fieldIdsFrom, clipOutcomeMessage, SETTINGS_KEYS } from "./settings.js";

const api = globalThis.browser ?? globalThis.chrome;

// Menus are registered on install AND on startup: MV3 workers are killed when
// idle, and `onInstalled` does not fire again when one is revived.
const registerMenus = () => {
  api.contextMenus.removeAll(() => {
    for (const m of CLIP_MENUS) api.contextMenus.create(m);
  });
};
api.runtime.onInstalled.addListener(async (details) => {
  registerMenus();
  // A fresh install has no token, so every clip would fail its settings check.
  // Open the options page now rather than let the first right-click do nothing.
  if (details?.reason === "install") {
    const stored = await api.storage.sync.get(SETTINGS_KEYS);
    if (!validateSettings(stored).ok) api.runtime.openOptionsPage?.();
  }
});
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

/**
 * WHICH GRID. The options field is a per-device OVERRIDE, not the setting —
 * left blank (the default) the app decides, through the same "Shares land in"
 * picker the Imports tab writes. `POST /share` does that resolution itself, so
 * the POST simply omits the key; this lookup exists because the FIELDS call
 * needs a concrete grid, and asking is better than guessing one.
 */
async function shareGridFor({ baseUrl, token }) {
  const res = await fetch(`${baseUrl}/api/v1/me/share`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const body = await res.json().catch(() => ({}));
  return body.gridId || null;
}

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
  // Not set up: a system notification is easy to miss (Windows hides them by
  // default), and a click that shows nothing reads as broken. Open the page
  // that fixes it.
  if (!check.ok) { notify(check.message); api.runtime.openOptionsPage?.(); return; }
  const { baseUrl, token, parentId } = check.settings;
  // `gridId` from the options OVERRIDES the app; blank means "wherever the app
  // says", which is the common case and the one that cannot go stale.
  const overrideGridId = check.settings.gridId || null;

  let fieldIds = {};
  try {
    const gridId = overrideGridId || (await shareGridFor({ baseUrl, token }));
    if (gridId) fieldIds = await fieldIdsFor({ baseUrl, token, gridId });
  } catch { /* clip without fields */ }

  const record = buildClipRecord({ info, tab: tab || {}, fieldIds, parentId });
  // `null` means the click carried no URL at all — nothing to be idempotent on.
  if (!record) { notify("Nothing to clip here — no address on that item."); return; }

  const shareBody = {
    // Omitted when the options field is blank, so the server resolves it
    // from the user's own share setting rather than from this device's.
    ...(overrideGridId ? { gridId: overrideGridId } : null),
    source: "extension",
    url: record.moduleFileRef, shape: record.meta?.clipShape, title: tab?.title || null,
    text: info.selectionText || null,
    // So a shared calendar is read in YOUR zone; the server remembers it
    // for senders that cannot say (curl, Windows "open with").
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    clip: record,
  };

  // "choose…": STAGE the clip and open the placement window on it. Nothing is
  // written until Clip is pressed there; closing the window lets the stage
  // expire. The key in the URL authorizes that one clip and nothing else.
  if (isChooseMenu(info.menuItemId)) {
    try {
      const res = await fetch(`${baseUrl}/api/v1/share/stage`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(shareBody),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.stageId) { notify(`Clip failed: ${body.message || body.error || `HTTP ${res.status}`}`); return; }
      await api.windows.create({
        type: "popup", width: 520, height: 700,
        url: `${baseUrl}/share-place?stage=${encodeURIComponent(body.stageId)}&k=${encodeURIComponent(body.key)}`,
      });
    } catch (e) {
      notify(`Clip failed: ${e?.message || "could not reach Moduli"}`);
    }
    return;
  }

  // Through the SHARE RULES (D15), not straight to /ingest — so a clip and a
  // phone share of the same link obey the same rules. The record still rides
  // along as `clip`: the grid's catch-all writes it exactly as /ingest did, so
  // day one is unchanged, and a `link` rule you write can take over.
  try {
    const res = await fetch(`${baseUrl}/api/v1/share`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(shareBody),
    });
    const body = await res.json().catch(() => ({}));
    notify(clipOutcomeMessage(res.ok ? body : { ok: false, error: body.message || body.error || `HTTP ${res.status}` }));
  } catch (e) {
    notify(`Clip failed: ${e?.message || "could not reach Moduli"}`);
  }
});
