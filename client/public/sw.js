// public/sw.js — Moduli's service worker. It does ONE thing: receive shares.
//
// The web-app manifest's `share_target` makes the OS POST a share (a link, some
// text, a photo, a calendar invite) to /share-target as a form. That POST
// carries no credential, and /api/v1/share needs one — so this keeps the
// original form in Cache Storage and redirects (303, so a reload does not
// re-submit) to /share-pending, a page that CAN read the signed-in session.
//
// It also keeps an OFFLINE SHELL (2026-10-13): the last good copy of the app page
// and the hashed /assets/ files it loaded, so a cold start with no network still
// boots — and then draws the last visit's grid from IndexedDB (src/helpers/
// bootSnapshot.js), with edits queued until the server is back. A page load is
// NETWORK FIRST (an online load is exactly as before); an /assets/ file is cache
// first (its name changes whenever its content does). Everything else — the API,
// the socket, uploads — passes through untouched.
//
// Keep in step with src/helpers/shareHandoff.js (a test compares them):
const SHARE_CACHE = "moduli-share-handoff";
const stashUrl = (id) => `/__share-stash/${encodeURIComponent(id)}`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const SHELL_CACHE = "moduli-shell";
const ASSET_CACHE = "moduli-assets";
const SHELL_KEY = "/__shell";
// Hashed chunks pile up across deploys; keep the newest this many.
const MAX_ASSETS = 400;

// A page the app renders (not a file, an API call, an upload or the share POST).
function isAppNavigation(request, url) {
  if (request.method !== "GET" || request.mode !== "navigate") return false;
  if (url.origin !== self.location.origin) return false;
  if (/^\/(api|uploads|files|artifacts|socket\.io|share-target)(\/|$)/.test(url.pathname)) return false;
  return !/\.[a-z0-9]+$/i.test(url.pathname);
}

async function networkFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok && (res.headers.get("content-type") || "").includes("text/html")) {
      await cache.put(SHELL_KEY, res.clone());
    }
    return res;
  } catch (err) {
    const cached = await cache.match(SHELL_KEY);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) {
    await cache.put(request, res.clone());
    try {
      const keys = await cache.keys();
      for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(k);
    } catch { /* trimming is best effort */ }
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method === "GET") {
    const url = new URL(request.url);
    if (isAppNavigation(request, url)) { event.respondWith(networkFirstShell(request)); return; }
    if (url.origin === self.location.origin && url.pathname.startsWith("/assets/")) { event.respondWith(cacheFirstAsset(request)); return; }
    return;
  }
  if (request.method !== "POST") return;
  const url = new URL(request.url);
  if (url.pathname !== "/share-target") return;

  // Absolute, from the request itself: Response.redirect needs a URL it can
  // parse, and a relative one relies on the worker's base URL being applied.
  const to = (pathAndQuery) => new URL(pathAndQuery, request.url).href;

  event.respondWith((async () => {
    try {
      const form = await request.formData();
      const id = (self.crypto && self.crypto.randomUUID) ? self.crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
      const cache = await caches.open(SHARE_CACHE);
      await cache.put(stashUrl(id), new Response(form));
      return Response.redirect(to(`/share-pending?id=${encodeURIComponent(id)}`), 303);
    } catch (err) {
      // A share must never silently vanish (spec §12).
      const msg = `Moduli couldn't read that share: ${err && err.message ? err.message : err}`;
      return Response.redirect(to(`/share-pending?error=${encodeURIComponent(msg)}`), 303);
    }
  })());
});
