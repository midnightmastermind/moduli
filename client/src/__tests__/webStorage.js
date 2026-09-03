// __tests__/webStorage.js
//
// A WORKING `localStorage` FOR THE TEST ENVIRONMENT.
//
// Node 25 ships its own Web Storage implementation, and it occupies
// `globalThis.localStorage` before jsdom's does. Without a valid
// `--localstorage-file` it hands back an EMPTY PLAIN OBJECT — so
// `localStorage.clear()` is not a function and every suite that touches
// storage dies on its first `beforeEach`:
//
//     Test Files  42 failed | 277 passed (319)
//     Tests       31 failed | 3500 passed (3531)
//     TypeError: localStorage.clear is not a function
//
// jsdom's own is not recoverable in that realm — it is absent from the global,
// absent from the prototype chain, and deleting Node's leaves `undefined`.
// `sessionStorage` is untouched, which is exactly why only these suites broke.
//
// ── IT IS GUARDED, SO IT DISAPPEARS THE DAY THE ENVIRONMENT IS FIXED ───────
// `installWebStorage` writes nothing when the global already answers the
// Storage interface. A shim that installs unconditionally would keep shadowing
// a real implementation long after the reason for it was gone — and the next
// person would be debugging OUR storage instead of the browser's.
//
// ── IT COERCES, BECAUSE THAT IS WHERE THE BUGS ARE ────────────────────────
// Real Storage stringifies keys AND values and returns `null` (not undefined)
// for a missing key. A Map-backed shim that skipped that would let
// `setItem("n", 1)` read back as the NUMBER 1 — green here, broken in a
// browser. Same reason it is a Proxy: real Storage exposes its entries as
// properties, and this codebase documents `localStorage["moduli-haptics"] =
// "off"` as a user-facing incantation.

/** A spec-shaped Storage. Keys and values are strings; misses are null. */
export function makeWebStorage() {
  const map = new Map();
  const api = {
    getItem(k) { k = String(k); return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(String(k), String(v)); },
    removeItem(k) { map.delete(String(k)); },
    clear() { map.clear(); },
    key(i) { const ks = [...map.keys()]; i = Math.trunc(Number(i)) || 0; return i >= 0 && i < ks.length ? ks[i] : null; },
    get length() { return map.size; },
  };
  const own = (p) => typeof p === "string" && map.has(p);
  return new Proxy(api, {
    get(t, p, r) { return Reflect.has(t, p) ? Reflect.get(t, p, r) : (own(p) ? map.get(p) : undefined); },
    set(t, p, v) { if (Reflect.has(t, p)) return Reflect.set(t, p, v); map.set(String(p), String(v)); return true; },
    has(t, p) { return Reflect.has(t, p) || own(p); },
    deleteProperty(t, p) { if (Reflect.has(t, p)) return Reflect.deleteProperty(t, p); map.delete(String(p)); return true; },
    ownKeys() { return [...map.keys()]; },
    getOwnPropertyDescriptor(t, p) {
      if (own(p)) return { value: map.get(p), writable: true, enumerable: true, configurable: true };
      return Reflect.getOwnPropertyDescriptor(t, p);
    },
  });
}

/** True when `globalThis[name]` already answers the Storage interface. */
export function hasWorkingStorage(name, host = globalThis) {
  const s = host?.[name];
  return !!s && typeof s.getItem === "function" && typeof s.setItem === "function"
    && typeof s.removeItem === "function" && typeof s.clear === "function";
}

/**
 * Install a shim for any of `names` the environment does not already provide.
 * Returns the names actually installed, so the caller can say so out loud.
 */
export function installWebStorage(names = ["localStorage", "sessionStorage"], host = globalThis) {
  const installed = [];
  for (const name of names) {
    if (hasWorkingStorage(name, host)) continue;
    const store = makeWebStorage();
    Object.defineProperty(host, name, { value: store, writable: true, configurable: true });
    // jsdom usually makes `window` the global object, but never assume it:
    // a `window` that disagreed with the global is a bug nobody would find.
    if (typeof host.window !== "undefined" && host.window !== host) {
      Object.defineProperty(host.window, name, { value: store, writable: true, configurable: true });
    }
    installed.push(name);
  }
  return installed;
}
