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

// ── THE LOOKUP ITSELF, AND WHY IT NEEDED ITS OWN FUNCTION ───────────────────
//
// This was one line in the handler — `snapshotFrom(await res.json())` — and
// measured 2026-09-10 it is the least reliable link in the whole browser:
//
//     5 serial lookups, 400ms apart:   429 · 429 · 429 · 429 · 200
//
// archive.org rate-limits hard, and there was no retry. Worse, it answers a
// rate-limit with an HTML ERROR PAGE, and one observed variant carries **HTTP
// 200** with that HTML body — which sails straight past `if (!res.ok)` into
// `res.json()`, throws, and reaches the user as the literal string
// `Unexpected token '<'`.
//
// That matters more than it looks: ~54% of this library's bookmarks resolve to
// a mode that depends on this answer (32% refuse framing outright, 22% cannot be
// fetched at all), and for those the snapshot is not a nicety — measured on the
// Washington Post it is the ONLY thing that renders, and it is strictly better
// than the live page (framable, and 1,614 reader words against 91).
//
// SO: retry the statuses that mean "ask again", honour `Retry-After` when the
// archive names one, and treat a non-JSON body as a REFUSAL with an honest
// reason rather than letting the parser throw prose at the user.
//
// ONE SHARED DEADLINE, the same discipline `fetchPageHtml` takes: three attempts
// must never cost more wall time than the caller allowed, or a fix for an
// unreliable lookup becomes a slow one. Someone is watching this — the strip
// says "Looking for a saved copy…" while it runs.

/** Statuses where asking again is the right move. A 404 is an answer; these are not. */
const WAYBACK_RETRY = new Set([429, 500, 502, 503, 504]);

/** `Retry-After` in seconds, clamped so the archive cannot park us for a minute. */
export function retryAfterMs(header, cap = 2000) {
  const secs = Number(String(header ?? "").trim());
  if (!Number.isFinite(secs) || secs <= 0) return null;
  return Math.min(secs * 1000, cap);
}

/**
 * Ask the Wayback Machine for the closest snapshot of `url`.
 *
 * Always resolves — never throws — because every caller wants a REASON to show
 * rather than an exception to catch.
 */
export async function fetchWaybackSnapshot(url, {
  totalMs = 8000, attempts = 3, fetchImpl, sleep,
} = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  const nap = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const deadline = Date.now() + totalMs;
  let last = { ok: false, reason: "the archive could not be reached" };

  for (let i = 0; i < attempts; i++) {
    const remaining = deadline - Date.now();
    // Out of budget. Report what we last learned rather than firing a request
    // we cannot wait for.
    if (remaining <= 0) return last;
    try {
      const res = await doFetch(waybackQueryUrl(url), {
        signal: AbortSignal.timeout(remaining),
        headers: { "User-Agent": "Moduli/1.0 (+https://viafluere.com)", Accept: "application/json" },
      });
      if (WAYBACK_RETRY.has(res.status)) {
        last = { ok: false, reason: `the archive is busy (${res.status})` };
        // The archive's own number when it gives one, else a widening back-off.
        const wait = retryAfterMs(res.headers?.get?.("retry-after")) ?? (250 * 2 ** i);
        if (i < attempts - 1 && Date.now() + wait < deadline) { await nap(wait); continue; }
        return last;
      }
      if (!res.ok) return { ok: false, reason: `the archive answered ${res.status}` };

      // A 200 IS NOT A PROMISE OF JSON — that is the whole reason this branch
      // exists. Parsed from text so an HTML error page becomes a reason instead
      // of a `SyntaxError` wearing the user's error message.
      const body = await res.text();
      try {
        return snapshotFrom(JSON.parse(body));
      } catch {
        last = { ok: false, reason: "the archive is busy" };
        const wait = 250 * 2 ** i;
        if (i < attempts - 1 && Date.now() + wait < deadline) { await nap(wait); continue; }
        return last;
      }
    } catch (err) {
      const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
      last = { ok: false, reason: timedOut ? "the archive timed out" : (err?.message || "lookup failed") };
      // A timeout has already spent the budget; retrying cannot help.
      if (timedOut) return last;
      const wait = 250 * 2 ** i;
      if (i < attempts - 1 && Date.now() + wait < deadline) { await nap(wait); continue; }
      return last;
    }
  }
  return last;
}
