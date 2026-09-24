// public/sw.js — Moduli's service worker. It does ONE thing: receive shares.
//
// The web-app manifest's `share_target` makes the OS POST a share (a link, some
// text, a photo, a calendar invite) to /share-target as a form. That POST
// carries no credential, and /api/v1/share needs one — so this keeps the
// original form in Cache Storage and redirects (303, so a reload does not
// re-submit) to /share-pending, a page that CAN read the signed-in session.
//
// Everything else passes through untouched: no caching, no offline mode. A
// request this worker does not answer goes to the network exactly as if the
// worker were not installed.
//
// Keep in step with src/helpers/shareHandoff.js (a test compares them):
const SHARE_CACHE = "moduli-share-handoff";
const stashUrl = (id) => `/__share-stash/${encodeURIComponent(id)}`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const { request } = event;
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
