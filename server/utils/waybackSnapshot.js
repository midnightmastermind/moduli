// server/utils/waybackSnapshot.js
//
// "Show me the WEB ARCHIVE of this page" — the third mode beside Reader and Web.
//
// User, 2026-08-23: *"add a web arcvhive version in next to web (do that last)
// where we search for the web archive of the page"* / *"make that next to reader
// mode and web mode"*.
//
// It earns a place the other two modes cannot fill: a DEAD link, and a page whose
// live version is paywalled, rewritten, or behind a login. A bookmark list years
// deep contains both.
//
// EVERYTHING INTERESTING HERE WAS MEASURED AGAINST THE REAL API, not read off its
// documentation — and one of the three measurements is a defect this file exists
// to prevent:
//
//   the reply shape       archived_snapshots.closest.{url,timestamp,available,status}
//   NEVER ARCHIVED        archived_snapshots: {}   <- an EMPTY OBJECT on a 200.
//                         Not a 404, not an error. Code that only checks
//                         `res.ok` reads "no snapshot exists" as success and
//                         then dereferences nothing.
//   THE URL COMES BACK    http://web.archive.org/web/<ts>/<url>
//   AS http://            The grid is served over https, so framing that URL is
//                         MIXED CONTENT — the browser blocks it and the panel
//                         shows a silent blank box that looks exactly like a
//                         site refusing to frame. https serves the identical
//                         snapshot (measured: 200), so the scheme is upgraded
//                         here rather than left to look like a bug later.
//
// AND THE MODE IS WORTH BUILDING BECAUSE OF A FOURTH MEASUREMENT: a snapshot
// sends a CSP with NO `frame-ancestors` and no `x-frame-options`, so
// **archive.org frames without the extension** where the live site does not.
// That is the case the strip's third button is really for.
//
// PURE. The fetch is one line in the handler; every way this can be wrong lives
// here, where a test can drive it.

export const WAYBACK_API = "https://archive.org/wayback/available";

/** The availability query for a url. The url is a QUERY VALUE — encode it. */
export function waybackQueryUrl(url) {
  return `${WAYBACK_API}?url=${encodeURIComponent(String(url || ""))}`;
}

/**
 * `20260817224150` (UTC) -> an ISO instant.
 * Built with Date.UTC rather than parsed: `new Date("20260817224150")` is
 * Invalid Date, which would render as "Invalid Date" beside the snapshot.
 */
export function parseWaybackTimestamp(ts) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(ts || ""));
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const at = Date.UTC(y, mo - 1, d, h, mi, s);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

/**
 * Read the availability reply.
 * @returns { ok: true, url, timestamp, capturedAt, status } | { ok: false, reason }
 */
export function snapshotFrom(json) {
  const closest = json?.archived_snapshots?.closest;
  // The empty-object case, which is what "we have never captured this" looks
  // like. It is the ordinary answer for a private URL, a localhost link, or a
  // deep path nobody crawled — so it is a REASON, never an error.
  if (!closest || !closest.url) return { ok: false, reason: "no snapshot in the Wayback Machine" };
  if (closest.available === false) return { ok: false, reason: "the snapshot is not available" };
  return {
    ok: true,
    // The mixed-content upgrade. Only the archive's own host is rewritten: the
    // ORIGINAL url is embedded in the path, and rewriting that would change
    // which capture is requested.
    url: String(closest.url).replace(/^http:\/\/web\.archive\.org\//i, "https://web.archive.org/"),
    timestamp: closest.timestamp || null,
    capturedAt: parseWaybackTimestamp(closest.timestamp),
    status: closest.status || null,
  };
}
