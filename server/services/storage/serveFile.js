// services/storage/serveFile.js — stream a stored file from any storage
// backend to an HTTP response, with Range support and caching headers.
// Used by the /files/:connectionId/:fileId proxy (plan Task 5); backend-blind,
// so a later backend (S3, Dropbox) is served by the same function.

/** "bytes=0-99" / "bytes=100-" / "bytes=-500" → { start, end } | null (whole file) | "invalid". */
export function parseRange(header, size = null) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  if (m[1] === "") {                       // suffix: the last N bytes
    if (size == null) return null;         // size unknown: answer with the whole file (a valid reply)
    const n = Number(m[2]);
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === "" ? null : Number(m[2]);
  if (end != null && end < start) return "invalid";
  return { start, end };
}

export async function serveStoredFile(req, res, backend, ref) {
  // A stored file's id never changes content, so its ETag is the ref itself.
  const etag = `"${Buffer.from(ref).toString("base64url")}"`;
  if (req.headers["if-none-match"] === etag) return res.status(304).end();

  const range = parseRange(req.headers.range);
  if (range === "invalid") return res.status(416).end();

  const file = await backend.open(ref, range || {});
  if (!file) return res.status(404).json({ error: "not_found", message: "This file is missing from its storage (deleted or moved in Drive)." });

  res.setHeader("Cache-Control", "private, max-age=2592000, immutable");
  res.setHeader("ETag", etag);
  res.setHeader("Accept-Ranges", "bytes");
  if (file.mime) res.setHeader("Content-Type", file.mime);

  if (range && (file.status === 206 || file.contentRange)) {
    res.status(206);
    if (file.contentRange) res.setHeader("Content-Range", file.contentRange);
    else if (file.size != null) res.setHeader("Content-Range", `bytes ${range.start}-${range.end ?? file.size - 1}/${file.size}`);
    if (file.length) res.setHeader("Content-Length", String(file.length));
  } else if (file.length || file.size) {
    res.setHeader("Content-Length", String(file.length || file.size));
  }

  file.stream.on("error", (e) => { console.error("[files] stream failed:", e.message); res.destroy(e); });
  req.on("close", () => file.stream.destroy?.());
  file.stream.pipe(res);
}
