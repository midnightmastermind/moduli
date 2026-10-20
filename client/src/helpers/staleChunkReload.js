// A tab opened before a deploy still runs the OLD build. Its lazy chunks (the book reader's
// view-<hash>.js, pdf.js, the op worker…) are named by that build's hashes, and once the server
// no longer has one, the dynamic import fails: "Failed to fetch dynamically imported module".
// The deploy keeps old chunks for a week; this is the backstop for a tab older than that, or a
// chunk lost some other way. Vite dispatches `vite:preloadError` on such a failure: reload once
// to pick up the current build. At most once a minute, so a chunk that is genuinely missing
// from the NEW build too cannot reload-loop — the error then surfaces as before.
const KEY = "moduli-stale-chunk-reload";
const MIN_GAP_MS = 60_000;

export function shouldReloadForStaleChunk(lastAt, now) {
  const last = Number(lastAt);
  return !Number.isFinite(last) || last <= 0 || now - last > MIN_GAP_MS;
}

export function installStaleChunkReload(win = window) {
  win.addEventListener("vite:preloadError", (event) => {
    let last = null;
    try { last = win.sessionStorage.getItem(KEY); } catch { /* storage blocked */ }
    const now = Date.now();
    if (!shouldReloadForStaleChunk(last, now)) return; // let the caller show its error
    try { win.sessionStorage.setItem(KEY, String(now)); } catch { /* storage blocked */ }
    event.preventDefault();
    win.location.reload();
  });
}
