// BOOT SNAPSHOT — the last full_state, kept in IndexedDB, drawn at boot while the real one
// downloads. Measured on poms grid at phone size (4x CPU): the 15.9MB full_state reaches the tab
// ~5s after the socket opens (~12s on 4G) and rows appear ~3.7s after it, so most of a phone load
// is the WAIT. The snapshot is a read-only preview (state/snapshotMode); the real full_state
// replaces it whole.
//
// Every call FAILS QUIET: no IndexedDB, a private window, a full quota or a blocked open all mean
// "no snapshot", never an error on the load path.
export const SNAPSHOT_VERSION = 1;
const DB = "moduli-boot";
const STORE = "snapshots";
// A snapshot older than this is not worth showing — too much may have changed.
export const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export const snapshotKey = (userId, gridId) => (userId && gridId ? `${userId}:${gridId}` : null);

function openDb() {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { try { req.result.createObjectStore(STORE); } catch { /* exists */ } };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

// The default store; tests pass their own { get, put, clear }.
const idbStore = {
  async get(key) {
    const db = await openDb(); if (!db) return null;
    return new Promise((resolve) => {
      try {
        const r = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
        r.onsuccess = () => resolve(r.result ?? null); r.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  },
  async put(key, value) {
    const db = await openDb(); if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve(true); tx.onerror = () => resolve(false); tx.onabort = () => resolve(false);
      } catch { resolve(false); }
    });
  },
  async clear() {
    const db = await openDb(); if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve(true); tx.onerror = () => resolve(false);
      } catch { resolve(false); }
    });
  },
};

// The payload as the reducer takes it. The DEFERRED half (the artifact catalogue) is not in it —
// it is not on screen, and the real load sends it anyway.
export function snapshotRecord(payload, now = Date.now()) {
  if (!payload?.gridId) return null;
  return { v: SNAPSHOT_VERSION, savedAt: now, payload };
}

export function usableSnapshot(record, { gridId, now = Date.now() } = {}) {
  if (!record || record.v !== SNAPSHOT_VERSION || !record.payload) return null;
  if (gridId && record.payload.gridId !== gridId) return null;
  if (!(now - record.savedAt <= SNAPSHOT_MAX_AGE_MS)) return null;
  return record.payload;
}

export async function saveBootSnapshot(userId, payload, { store = idbStore, now } = {}) {
  const key = snapshotKey(userId, payload?.gridId);
  const rec = snapshotRecord(payload, now);
  if (!key || !rec) return false;
  try { return await store.put(key, rec); } catch { return false; }
}

export async function loadBootSnapshot(userId, gridId, { store = idbStore, now } = {}) {
  const key = snapshotKey(userId, gridId);
  if (!key) return null;
  try { return usableSnapshot(await store.get(key), { gridId, now }); } catch { return null; }
}

export async function clearBootSnapshots({ store = idbStore } = {}) {
  try { return await store.clear(); } catch { return false; }
}
