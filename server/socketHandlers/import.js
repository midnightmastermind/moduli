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
import { htmlToMarkdown } from "../services/wikipediaTools.js";
import { markdownToModuli } from "../services/markdownImporter.js";

export function registerImportHandlers(socket, { io, userRoom }) {
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
}
