// services/jellyfinProxy.js — session-authorized streaming proxy for Jellyfin media. The browser plays through
// /api/v1/jellyfin/media/<jellyfin path>; the server adds the key, so it never reaches the client.
import { Readable } from "node:stream";
import { jellyfinFetch } from "./jellyfinConfig.js";

const HEADER_TIMEOUT_MS = 5000;
const ALLOWED_PREFIXES = ["/Videos/", "/Items/", "/Audio/"];
const STRIP_QUERY = new Set(["t", "api_key", "apikey"]);
const COPY_RES_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "etag", "last-modified"];
const FWD_REQ_HEADERS = ["range", "if-range", "if-none-match", "if-modified-since", "accept"];

export const isAllowedPath = (p) => ALLOWED_PREFIXES.some((x) => p.startsWith(x)) && !p.split("/").includes("..");
const isPlaylist = (path, ct) => /\.m3u8$/i.test(path) || /mpegurl/i.test(ct || "");

/** Append `t=<token>` to every URI line of an HLS playlist (relative URLs do not carry the proxy's ?t=).
 *  Also rewrites URI="..." attributes in tag lines (EXT-X-MAP / KEY / MEDIA). */
export function rewritePlaylist(text, token) {
  if (!token) return text;
  const add = (u) => {
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(u)) return u;
    const hash = u.indexOf("#");
    const base = hash >= 0 ? u.slice(0, hash) : u;
    const frag = hash >= 0 ? u.slice(hash) : "";
    return `${base}${base.includes("?") ? "&" : "?"}t=${encodeURIComponent(token)}${frag}`;
  };
  return text.split(/\r?\n/).map((line) => {
    if (!line.trim()) return line;
    if (line.startsWith("#")) return line.replace(/URI="([^"]*)"/g, (_m, u) => `URI="${add(u)}"`);
    return add(line.trim());
  }).join("\n");
}

export async function proxyJellyfin(req, res, cfg) {
  const rest = req.params.rest ?? req.params[0] ?? "";
  const sub = "/" + (Array.isArray(rest) ? rest.join("/") : String(rest)).replace(/^\/+/, "");
  const method = req.method.toUpperCase();
  const okMethod = method === "GET" || method === "HEAD" || (method === "DELETE" && sub.startsWith("/Videos/ActiveEncodings"));
  if (!okMethod || !isAllowedPath(sub)) return res.status(404).json({ error: "not_found", code: "not_found", message: "Not found" });

  const token = typeof req.query.t === "string" ? req.query.t : "";
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (STRIP_QUERY.has(k.toLowerCase())) continue;
    for (const one of [].concat(v)) qs.append(k, String(one));
  }
  const headers = { "accept-encoding": "identity" };
  for (const h of FWD_REQ_HEADERS) if (req.headers[h]) headers[h] = req.headers[h];

  const ctl = new AbortController();
  const onClose = () => { if (!res.writableEnded) ctl.abort(); };
  res.on("close", onClose);

  let up;
  try {
    up = await jellyfinFetch(cfg, sub + (qs.toString() ? `?${qs}` : ""), { method, headers, headerTimeoutMs: HEADER_TIMEOUT_MS, signal: ctl.signal });
  } catch (e) {
    if (res.headersSent || ctl.signal.aborted) return; // browser already left
    return res.status(503).json({ error: "media_offline", code: "media_offline", message: "Jellyfin is unreachable" });
  }

  const ct = up.headers.get("content-type") || "";
  res.status(up.status);
  for (const h of COPY_RES_HEADERS) {
    const v = up.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  if (method === "HEAD" || !up.body) return res.end();

  if (isPlaylist(sub, ct)) {
    try {
      const body = rewritePlaylist(await up.text(), token);
      res.removeHeader("content-length");
      res.setHeader("content-length", Buffer.byteLength(body));
      return res.end(body);
    } catch { return res.destroy(); }
  }
  const stream = Readable.fromWeb(up.body);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}
