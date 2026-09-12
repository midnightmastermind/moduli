// socketHandlers/import.js
//
// Drag-to-import socket handler. Mirrors POST /api/v1/import/text but
// runs over the user's already-authenticated socket — so the in-app
// drop UX doesn't require the user to set up a Bearer API token.
//
// Event: `import_text`
//   payload: { content, format?, gridId, parentId?, title?, htmlOpts?, requestId }
//     content   — required string (html / markdown / plain text)
//     format    — "auto" (default) | "html" | "markdown" | "text"
//     gridId    — required
//     parentId  — optional occurrence id; the import root is appended there
//     title     — used as the root container label when content has no leading H1
//     htmlOpts  — passed through to htmlToMarkdown (keepImages / keepTables /
//                 keepFigures / stripClasses). Default: keep all media.
//     requestId — opaque correlation id the client uses to await the response
//
// Response (via callback `import_text_result`):
//   { ok, requestId, rootOccurrenceId, stats, detectedFormat, error? }
//
// Side effects: emits `module_created` + `occurrence_created` to the user's
// socket room for every minted entity (the existing client store handlers
// fold them into local state — no client-side ID tracking needed).
// Event: `import_plan`
//   payload: { content, gridId?, title?, requestId }
//   Response (via `import_plan_result`): { ok, requestId, rootOccurrenceId,
//                                          modules, occurrences, error? }
//
//   The SAME importer as `import_text`, run with `dryRun: true`. Plans the
//   tree and writes NOTHING — no Mongo, no warm cache, no broadcast. Backs
//   reader mode, which renders the planned occurrences through the app's own
//   renderers without minting them (see the handler for the measurement).
//
// Event: `import_url`  (the in-app half of POST /api/v1/import/url)
//   payload: { url, gridId, parentId?, title?, requestId }
//   Response (via `import_url_result`): { ok, requestId, rootOccurrenceId, sourceUrl, stats, error? }
//
//   Backs "convert this link to a page" (user, 2026-08-07). Same guarded fetch
//   as the REST route — the client cannot be trusted to have vetted the URL,
//   and the SERVER is the thing with network reach, so the check lives here
//   rather than in the caller.
import { htmlToMarkdown, wikiHtmlToMarkdown } from "../services/wikipediaTools.js";
import { markdownToModuli, planReaderShape } from "../services/markdownImporter.js";
import { persistImportResult } from "../utils/persistImport.js";
import { fetchPageHtml } from "../utils/safeFetchUrl.js";
import { fetchWaybackSnapshot } from "../utils/waybackSnapshot.js";
import { fetchLinkPreview } from "../utils/linkPreview.js";
import { extractMainContent } from "../utils/mainContent.js";
import { readerFromHtml, readerIsUsable } from "../utils/readerExtract.js";
import { framingVerdict } from "../utils/framingVerdict.js";
import { extractLinks } from "../utils/harvestLinks.js";

// How long the INTERACTIVE reader fetch may take before it gives up and lets the
// frame have the page. Exported so the rule is testable rather than a number
// buried in a handler. See the call site for why it is not `safeFetchUrl`'s 20s.
export const READER_TIMEOUT_MS = 6000;

// Name the page from its own <title> when the caller didn't supply one, so a
// converted link reads as the article rather than as its URL.
function titleFromHtml(html) {
  const m = /<title[^>]*>([\s\S]{1,300}?)<\/title>/i.exec(String(html || ""));
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

export function registerImportHandlers(socket, {
  io, userRoom, ensureUserCache, userCacheReady, loadUserIntoCache,
}) {
  // Get (or warm) the per-user/grid cache so we can keep it in sync with the DB write.
  async function getUC(userId, gridId) {
    if (!ensureUserCache) return null;
    if (userCacheReady && loadUserIntoCache && !userCacheReady(userId, gridId)) {
      await loadUserIntoCache(userId, gridId);
    }
    return ensureUserCache(userId, gridId);
  }
  socket.on("import_text", async (payload = {}, ack) => {
    const {
      content, format: rawFormat = "auto", gridId, parentId = null,
      title = "", htmlOpts = {}, requestId = null,
    } = payload;
    const userId = socket.userId;

    function reply(out) {
      if (typeof ack === "function") ack(out);
      socket.emit("import_text_result", { requestId, ...out });
    }

    try {
      if (!userId) return reply({ ok: false, error: "unauthenticated" });
      if (!gridId) return reply({ ok: false, error: "gridId required" });
      if (typeof content !== "string" || !content.trim()) {
        return reply({ ok: false, error: "content (non-empty string) required" });
      }

      // Resolve format with the same conservative HTML sniff /api/v1/import/text uses.
      let format = rawFormat;
      if (format === "auto") {
        format = /<\/?[a-z][\s\S]*?>/i.test(content) ? "html" : "markdown";
      }

      const markdown = format === "html"
        ? htmlToMarkdown(content, title, {
            keepImages: true, keepTables: true, keepFigures: true,
            ...htmlOpts,
          })
        : content;

      const result = await markdownToModuli({
        gridId, parentId, userId, markdown, dryRun: false, title,
      });

      // Persist to the DB + warm cache so the import survives a reload, THEN broadcast.
      const uc = await getUC(userId, gridId);
      await persistImportResult({ result, userId, uc });

      // Broadcast each created entity so all connected tabs (this one + others) sync.
      for (const m of result.modules) {
        io.to(userRoom(userId)).emit("module_created", { module: m });
      }
      for (const o of result.occurrences) {
        io.to(userRoom(userId)).emit("occurrence_created", { occurrence: o });
      }

      reply({
        ok: true,
        rootOccurrenceId: result.rootOccurrenceId,
        stats: result.stats,
        detectedFormat: format,
        // markdown is omitted to keep payload small — server logs / DB
        // have it if needed. Caller asks via REST when they want it.
      });
    } catch (err) {
      console.error("import_text error:", err);
      reply({ ok: false, error: err?.message || "internal error" });
    }
  });

  // THE SAME IMPORTER, STOPPED BEFORE IT WRITES (user, 2026-09-12: *"the reader
  // mode should be turning the things into textblocks and containers like the
  // wikipedia import"*).
  //
  // Reader mode wants the STRUCTURE the importer produces — headings as
  // containers, prose as textblocks, pull-quotes as quote artifacts, tables as
  // table containers — rendered by the app's own renderers rather than printed
  // as markdown source. What it must NOT do is mint those rows, and the
  // measurement is why:
  //
  //     WaPo article    1,619 words  ->   11 occurrences
  //     danbrown.com      814 words  ->   84 occurrences
  //     Wikipedia      11,678 words  ->  803 occurrences   (712 inline links)
  //                                 avg  299 per page read
  //     the live grid today               21,415 occurrences
  //
  // Reading ~26 Wikipedia-sized pages would DOUBLE the grid, and a spread page
  // is permanent by design ("nothing to clean up on close"), so there is no
  // teardown to lean on. Importing on open is therefore not a heavier version
  // of the right idea — it is a different feature, and `import_url` already is
  // it for the pages a user deliberately keeps.
  //
  // So this is `markdownToModuli`'s OWN dryRun, which the planner has carried
  // since it was written. ONE planner, two modes: a second "plan" path is
  // exactly how the read tree and the imported tree would drift, which is the
  // reason `readerExtract` reuses the import chain in the first place.
  //
  // READ-ONLY, and stronger than the other read-only handlers: it does not
  // touch Mongo, does not touch the warm cache, and broadcasts NOTHING — an
  // `occurrence_created` here would fold phantoms into every open tab's store,
  // which is the 2026-08-04 dangling-child-ref class handed a megaphone.
  socket.on("import_plan", async (payload = {}, ack) => {
    const { content, gridId, title = "", requestId = null, shape = "magic" } = payload;
    const userId = socket.userId;

    function reply(out) {
      if (typeof ack === "function") ack(out);
      socket.emit("import_plan_result", { requestId, ...out });
    }

    try {
      if (!userId) return reply({ ok: false, error: "unauthenticated" });
      if (typeof content !== "string" || !content.trim()) {
        return reply({ ok: false, error: "content (non-empty string) required" });
      }

      // `gridId` is stamped onto the planned rows so they look like every other
      // occurrence to the renderers. It is NOT authorization — nothing is
      // written — so an absent one plans fine rather than refusing.
      // TWO SHAPES, ONE PARSER (user, 2026-09-12). "reader" keeps the article
      // as one container + one textblock; "magic" is the importer's full tree.
      // Anything unrecognised gets MAGIC, which is what this handler returned
      // before the shape existed.
      const result = shape === "reader"
        ? planReaderShape({ gridId: gridId || null, userId, markdown: content, title: title || null })
        : await markdownToModuli({
            gridId: gridId || null, parentId: null, userId,
            markdown: content, dryRun: true, title,
          });

      reply({
        ok: true,
        rootOccurrenceId: result.rootOccurrenceId,
        modules: result.modules,
        occurrences: result.occurrences,
      });
    } catch (err) {
      console.error("import_plan error:", err);
      reply({ ok: false, error: err?.message || "internal error" });
    }
  });

  // What a link calls itself — its <title> and favicon — WITHOUT importing it.
  // The bookmark intake shape needs those to mint a record; fetching the whole
  // page and building a tree (import_url, below) is a different, much heavier
  // answer to a different question.
  //
  // Read-only: it creates nothing, so unlike the import handlers there is
  // nothing to broadcast and no cache to keep in step.
  socket.on("link_preview", async (payload = {}, ack) => {
    const { url, requestId = null } = payload;
    const reply = (out) => {
      if (typeof ack === "function") ack(out);
      socket.emit("link_preview_result", { requestId, ...out });
    };
    if (!socket.userId) return reply({ ok: false, error: "unauthenticated" });
    if (typeof url !== "string" || !url.trim()) return reply({ ok: false, error: "url required" });
    reply(await fetchLinkPreview(url, { fetchPageHtml }));
  });

  // WHAT a page points at, without importing any of it. Backs the intake shape
  // "…and follow its links" (user decision D5): the crawl runs first, the user
  // ticks the pages worth keeping, and only then does anything get imported.
  //
  // Read-only like `link_preview` — nothing minted, nothing to broadcast, no
  // cache to keep in step. The guarded fetch is the same one `import_url` uses;
  // the URL comes from a drop, so the server is the only place the check means
  // anything.
  //
  // The links are read from the MAIN CONTENT, not the raw page: a site's nav
  // and footer links belong to the site, not to the article you dropped, and on
  // a typical page they outnumber the real ones several times over.
  // READER MODE for the iframe view (2026-08-23). Fetch a page and hand back its
  // readable markdown — CREATES NOTHING.
  //
  // It is deliberately not `import_url`: that one builds a page tree in the
  // grid, which is the right answer to "keep this" and the wrong answer to
  // "let me read this". It runs the same fetch and the same extractor, so the
  // text you read is the text you would import.
  //
  // `usable` is the whole point of the reply. About half of the user's
  // bookmarks return a JavaScript shell server-side (reddit 0 words), and a
  // reader view showing nav chrome is worse than the site — so the client
  // switches to the live frame when this says false, rather than rendering an
  // empty page and calling it a feature.
  // ── THE SNAPSHOT IS *NOT* LOOKED UP HERE, AND THAT WAS MEASURED TWICE ────
  //
  // This handler briefly did the archive lookup itself and sent the snapshot in
  // the same reply, so the common case (35% of bookmarks refuse framing, 18%
  // cannot be fetched at all) cost ONE round trip instead of two serial ones.
  // The arithmetic was right and the change was wrong.
  //
  // User, 2026-09-10, using it: *"took too long"*. Awaiting the lookup pushed
  // FIRST PAINT from ~363ms out to 1-4.4s, because the reply was held until the
  // archive answered. **A person feels the first paint, not the total** — and the
  // round trip it bought back is ~50ms against a lookup costing 644ms-3.3s.
  //
  // So the read is answered as soon as it is read. The client fires
  // `wayback_lookup` the moment this says a page cannot be shown, and puts
  // "Looking for a saved copy…" on screen while that runs — which is feedback at
  // 363ms rather than a blank overlay for four seconds.
  //
  // If this is ever revisited: the answer is to REPLY first and PUSH the
  // snapshot after, never to await it.

  socket.on("page_reader", async (payload = {}, ack) => {
    const { url, title = "", requestId = null } = payload;
    const reply = (out) => {
      if (typeof ack === "function") ack(out);
      socket.emit("page_reader_result", { requestId, ...out });
    };
    try {
      if (!socket.userId) return reply({ ok: false, error: "unauthenticated" });
      if (!url) return reply({ ok: false, error: "url required" });
      // A SHORTER LEASH THAN AN IMPORT, because someone is WATCHING this one.
      //
      // `safeFetchUrl` gives a page 20 seconds, which is right for a background
      // import and wrong here: measured on the Washington Post, a site that
      // never answers burns the whole 20s while the overlay sits empty, and then
      // falls through to the frame — which renders in about a second. Waiting
      // twenty seconds for a NICETY when the fallback is that fast is a bad
      // trade, and the reader was never going to be usable on that page anyway.
      //
      // A JUDGEMENT, not a measurement: 6s is an interactive patience ceiling,
      // not something derived from these bookmarks. If a site you care about
      // starts falling through to the frame when its reader used to work, this
      // number is the reason and it is the thing to raise.
      const fetched = await fetchPageHtml(url, { timeoutMs: READER_TIMEOUT_MS });
      // The guard's reason is handed back verbatim so the strip can say WHY it
      // fell through to the frame ("timed out", "not a web page") rather than
      // silently switching modes.
      if (!fetched.ok) return reply({ ok: false, error: fetched.reason, usable: false });
      const { markdown, words } = readerFromHtml(fetched.html, title);
      // `framable` comes from the headers this fetch already received, so the
      // client can pick a mode that WORKS instead of framing, waiting, and
      // discovering a blank box.
      const frame = framingVerdict({ xFrameOptions: fetched.xFrameOptions, csp: fetched.csp });
      reply({
        ok: true, url: fetched.url, markdown, words,
        usable: readerIsUsable(words),
        framable: frame.framable, frameBlockedBy: frame.why,
      });
    } catch (err) {
      console.error("page_reader error:", err);
      reply({ ok: false, error: err?.message || "internal error", usable: false });
    }
  });

  // ── ARCHIVE MODE: the closest Wayback snapshot of a url ──────────────────
  //
  // The third mode beside Reader and Web (user: *"add a web arcvhive version in
  // next to web"*). It answers the two cases neither other mode can: a DEAD
  // link, and a page whose live version is paywalled or rewritten.
  //
  // READ-ONLY and LAZY. The client asks only when Archive is PICKED — the button
  // is always on the strip, but a lookup per bookmark opened would send a third
  // party a request for a mode most opens never use.
  //
  // Only archive.org is ever contacted, so this needs no SSRF guard: the
  // user's url is a QUERY VALUE, not the host. That is why it does not go
  // through `fetchPageHtml`, which validates a page fetch and would reject the
  // JSON this returns.
  socket.on("wayback_lookup", async (payload = {}, ack) => {
    const { url, requestId = null } = payload;
    const reply = (out) => {
      if (typeof ack === "function") ack(out);
      socket.emit("wayback_lookup_result", { requestId, ...out });
    };
    try {
      if (!socket.userId) return reply({ ok: false, reason: "unauthenticated" });
      if (!url) return reply({ ok: false, reason: "url required" });
      // EVERY WAY THIS CAN GO WRONG LIVES IN THE HELPER, where a test can drive
      // it — the retry on a rate limit, the honest reason for an HTML body on a
      // 200, and one shared deadline across the attempts. It always resolves, so
      // there is no error path to catch here.
      //
      // 8s rather than the 15s this used to allow: someone is WATCHING it (the
      // strip says "Looking for a saved copy…"), and a lookup that needs more
      // than eight seconds has already failed as far as the reader is concerned.
      reply(await fetchWaybackSnapshot(url, { totalMs: 8000 }));
    } catch (err) {
      const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
      reply({ ok: false, reason: timedOut ? "the archive timed out" : (err?.message || "lookup failed") });
    }
  });

  socket.on("link_harvest", async (payload = {}, ack) => {
    const { url, max, requestId = null } = payload;
    const reply = (out) => {
      if (typeof ack === "function") ack(out);
      socket.emit("link_harvest_result", { requestId, ...out });
    };
    try {
      if (!socket.userId) return reply({ ok: false, error: "unauthenticated" });
      if (typeof url !== "string" || !url.trim()) return reply({ ok: false, error: "url required" });

      const fetched = await fetchPageHtml(url);
      // The guard's own words, so the UI can say WHY ("not a web page",
      // "timed out") rather than a generic failure.
      if (!fetched.ok) return reply({ ok: false, error: fetched.reason });

      const { html: mainHtml } = extractMainContent(fetched.html);
      // `fetched.url` is the FINAL url after redirects — relative hrefs and the
      // exclude-itself test both have to resolve against where we ended up.
      const opts = Number.isFinite(max) && max > 0 ? { max } : {};
      const { links, truncated, total } = extractLinks(mainHtml, fetched.url, opts);
      reply({ ok: true, url: fetched.url, links, truncated, total });
    } catch (err) {
      console.error("link_harvest error:", err);
      reply({ ok: false, error: err?.message || "internal error" });
    }
  });

  socket.on("import_url", async (payload = {}, ack) => {
    const { url, gridId, parentId = null, title = "", requestId = null } = payload;
    const userId = socket.userId;

    function reply(out) {
      if (typeof ack === "function") ack(out);
      socket.emit("import_url_result", { requestId, ...out });
    }

    try {
      if (!userId) return reply({ ok: false, error: "unauthenticated" });
      if (!gridId) return reply({ ok: false, error: "gridId required" });
      if (!url) return reply({ ok: false, error: "url required" });

      const fetched = await fetchPageHtml(url);
      // The guard's reason is handed back verbatim so the UI can say WHY a
      // link refused to convert ("not a web page", "timed out", "redirected")
      // instead of a generic failure.
      if (!fetched.ok) return reply({ ok: false, error: fetched.reason });

      // Narrow to the article before converting — a raw page imports its
      // nav chrome as prose (measured on Wikipedia).
      const { html: mainHtml } = extractMainContent(fetched.html);
      const markdown = wikiHtmlToMarkdown(mainHtml, title);
      const result = await markdownToModuli({
        gridId, parentId, userId, markdown, dryRun: false,
        title: title || titleFromHtml(fetched.html) || fetched.url,
      });

      const uc = await getUC(userId, gridId);
      await persistImportResult({ result, userId, uc });

      for (const m of result.modules) io.to(userRoom(userId)).emit("module_created", { module: m });
      for (const o of result.occurrences) io.to(userRoom(userId)).emit("occurrence_created", { occurrence: o });

      reply({
        ok: true,
        rootOccurrenceId: result.rootOccurrenceId,
        sourceUrl: fetched.url,
        stats: result.stats,
      });
    } catch (err) {
      console.error("import_url error:", err);
      reply({ ok: false, error: err?.message || "internal error" });
    }
  });
}
