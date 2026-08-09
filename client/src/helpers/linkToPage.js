// helpers/linkToPage.js
//
// "Convert this link to a page" — user, 2026-08-07:
//   *"if i rightclick on an external link in our system, we should have a
//    convert to page"*
//
// This replaces the bulk link-harvest the intake plan originally carried. One
// link, on demand, from its own right-click menu: nothing unbounded, no
// guessing which links matter, and it composes with an importer that already
// knows how to build a whole tree from a page.
//
// The DECISION lives here as a pure function so the menu's gating is testable
// without a DOM: a link is convertible only when it points at an external
// http(s) URL. An in-app link (`kind:"occurrence"`) already goes somewhere in
// the grid — converting it would duplicate a page that exists.

/**
 * The external URL this occurrence links to, or null.
 *
 * Per-placement `occurrence.meta.link` wins over the template's
 * `module.meta.link` — the same precedence TextblockCard renders with.
 */
export function resolveExternalLink(occurrence, module) {
  const link = occurrence?.meta?.link || module?.meta?.link || null;
  if (!link) return null;
  // Only a URL link points OUTWARD. `kind:"occurrence"` is an in-app jump.
  if (link.kind && link.kind !== "url") return null;
  const url = typeof link.url === "string" ? link.url.trim() : "";
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

/** Should the right-click menu offer "Convert to page" here? */
export function canConvertLinkToPage(occurrence, module) {
  return !!resolveExternalLink(occurrence, module);
}

/**
 * Ask the server to fetch the link and build the page.
 *
 * The URL is NOT validated here — the server holds the guard
 * (`utils/safeFetchUrl.js`), because the server is the thing with network
 * reach and a client-side check would be advisory at best. This just carries
 * the request and reports the reason back.
 *
 * @returns {Promise<{ok:boolean, rootOccurrenceId?:string, error?:string}>}
 */
export function convertLinkToPage({ socket, gridId, url, parentId = null, title = "", timeoutMs = 45000 }) {
  if (!socket || !gridId || !url) {
    return Promise.resolve({ ok: false, error: "missing socket, gridId or url" });
  }
  // Fetch + import of a large page is slow, so the cap is generous — but it
  // MUST exist, or a server that never answers leaves the caller's spinner
  // running forever.
  return askServer({
    socket, timeoutMs, prefix: "link2page",
    event: "import_url", resultEvent: "import_url_result",
    payload: (requestId) => ({ requestId, gridId, url, parentId, title }),
  });
}

/**
 * The pages a link POINTS AT — the crawl behind "…and follow its links".
 *
 * Read-only: this imports nothing. It exists so the user can be shown the list
 * and tick what they want BEFORE anything is written (user decision D5), which
 * is the whole difference between this and calling `convertLinkToPage` in a
 * loop and hoping.
 *
 * `gridId` is deliberately NOT required — the server neither reads nor writes
 * the grid to answer this.
 *
 * @returns {Promise<{ok:boolean, url?:string, links?:Array<{url:string,label:string}>,
 *                    truncated?:boolean, total?:number, error?:string}>}
 */
export function harvestLinks({ socket, url, max = null, timeoutMs = 45000 }) {
  if (!socket || !url) {
    return Promise.resolve({ ok: false, error: "missing socket or url" });
  }
  return askServer({
    socket, timeoutMs, prefix: "harvest",
    event: "link_harvest", resultEvent: "link_harvest_result",
    payload: (requestId) => ({ requestId, url, ...(max ? { max } : {}) }),
  });
}

/**
 * One request/response round trip over the socket, correlated by requestId.
 *
 * Shared because getting this wrong is silent in the same two ways every time:
 * an uncorrelated listener answers to SOMEONE ELSE'S response (several of these
 * can be in flight — the follow-links route runs one import per page), and a
 * missing timeout leaves the caller waiting forever on a server that never
 * replies. Both are handled once here rather than per call.
 */
function askServer({ socket, event, resultEvent, payload, timeoutMs, prefix }) {
  return new Promise((resolve) => {
    const requestId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let settled = false;
    const finish = (out) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off?.(resultEvent, onResult);
      resolve(out);
    };
    const onResult = (res) => {
      if (res?.requestId && res.requestId !== requestId) return;
      finish(res || { ok: false, error: "no response" });
    };
    const timer = setTimeout(
      () => finish({ ok: false, error: `timed out after ${timeoutMs}ms` }),
      timeoutMs,
    );
    socket.on?.(resultEvent, onResult);
    socket.emit(event, payload(requestId));
  });
}
