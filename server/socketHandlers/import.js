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
// Event: `import_url`  (the in-app half of POST /api/v1/import/url)
//   payload: { url, gridId, parentId?, title?, requestId }
//   Response (via `import_url_result`): { ok, requestId, rootOccurrenceId, sourceUrl, stats, error? }
//
//   Backs "convert this link to a page" (user, 2026-08-07). Same guarded fetch
//   as the REST route — the client cannot be trusted to have vetted the URL,
//   and the SERVER is the thing with network reach, so the check lives here
//   rather than in the caller.
import { htmlToMarkdown, wikiHtmlToMarkdown } from "../services/wikipediaTools.js";
import { markdownToModuli } from "../services/markdownImporter.js";
import { persistImportResult } from "../utils/persistImport.js";
import { fetchPageHtml } from "../utils/safeFetchUrl.js";
import { fetchLinkPreview } from "../utils/linkPreview.js";
import { extractMainContent } from "../utils/mainContent.js";
import { readerFromHtml, readerIsUsable } from "../utils/readerExtract.js";
import { framingVerdict } from "../utils/framingVerdict.js";
import { extractLinks } from "../utils/harvestLinks.js";

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
  socket.on("page_reader", async (payload = {}, ack) => {
    const { url, title = "", requestId = null } = payload;
    const reply = (out) => {
      if (typeof ack === "function") ack(out);
      socket.emit("page_reader_result", { requestId, ...out });
    };
    try {
      if (!socket.userId) return reply({ ok: false, error: "unauthenticated" });
      if (!url) return reply({ ok: false, error: "url required" });
      const fetched = await fetchPageHtml(url);
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
