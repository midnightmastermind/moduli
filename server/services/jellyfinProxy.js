// services/jellyfinProxy.js — session-authorized streaming proxy for Jellyfin media. The browser plays through
// /api/v1/jellyfin/media/<jellyfin path>; the server adds the key, so it never reaches the client.
import { Readable } from "node:stream";
import { jellyfinFetch } from "./jellyfinConfig.js";

const HEADER_TIMEOUT_MS = 5000;
const ALLOWED_PREFIXES = ["/Videos/", "/Items/", "/Audio/"];
const STRIP_QUERY = new Set(["t", "api_key", "apikey"]);
const COPY_RES_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "etag", "last-modified"];
const FWD_REQ_HEADERS = ["range", "if-range", "if-none-match", "if-modified-since", "accept"];

const PROXY_PREFIX = "/api/v1/jellyfin/media";
const KEY_PARAMS = new Set(["api_key", "apikey"]);

/** Plain ids/names only: no backslash, percent or control characters (they hide dot-segments from a naive check).
 *  Returns the normalised pathname (what is actually sent upstream) or null. */
export function safePath(sub) {
  if (typeof sub !== "string" || /[\\%\u0000-\u001f\u007f]/.test(sub)) return null;
  let pathname;
  try { pathname = new URL(sub, "http://x").pathname; } catch { return null; }
  if (/[\\%]/.test(pathname)) return null;
  return ALLOWED_PREFIXES.some((x) => pathname.startsWith(x)) ? pathname : null;
}
export const isAllowedPath = (p) => safePath(p) !== null;
const isPlaylist = (path, ct) => /\.m3u8$/i.test(path) || /mpegurl/i.test(ct || "");

/** Make an HLS playlist safe to hand to the browser: drop api_key params, point absolute Jellyfin URLs and
 *  root-relative paths back at this proxy, and append `t=<token>` (relative URLs do not carry the proxy's ?t=).
 *  Also covers URI="..." attributes in tag lines (EXT-X-MAP / KEY / MEDIA). `baseUrl` is cfg.baseUrl. */
export function rewritePlaylist(text, token, baseUrl = "") {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const fix = (u) => {
    let out = u;
    if (base && out.toLowerCase().startsWith(base.toLowerCase() + "/")) out = out.slice(base.length);
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(out)) return out.replace(/([?&])(api_key|apikey)=[^&#]*&?/gi, "$1").replace(/[?&](?=#|$)/, "");
    const hash = out.indexOf("#");
    const frag = hash >= 0 ? out.slice(hash) : "";
    let rest = hash >= 0 ? out.slice(0, hash) : out;
    const q = rest.indexOf("?");
    let path = q >= 0 ? rest.slice(0, q) : rest;
    const params = (q >= 0 ? rest.slice(q + 1) : "").split("&").filter((kv) => kv && !KEY_PARAMS.has(kv.split("=")[0].toLowerCase()) && kv.split("=")[0] !== "t");
    if (path.startsWith("/")) path = PROXY_PREFIX + path;
    if (token) params.push(`t=${encodeURIComponent(token)}`);
    return `${path}${params.length ? "?" + params.join("&") : ""}${frag}`;
  };
  return text.split(/\r?\n/).map((line) => {
    if (!line.trim()) return line;
    if (line.startsWith("#")) return line.replace(/URI="([^"]*)"/g, (_m, u) => `URI="${fix(u)}"`);
    return fix(line.trim());
  }).join("\n");
}

export async function proxyJellyfin(req, res, cfg) {
  const rest = req.params.rest ?? req.params[0] ?? "";
  const raw = "/" + (Array.isArray(rest) ? rest.join("/") : String(rest)).replace(/^\/+/, "");
  const sub = safePath(raw);
  const method = req.method.toUpperCase();
  const okMethod = method === "GET" || method === "HEAD" || (method === "DELETE" && !!sub && sub.startsWith("/Videos/ActiveEncodings"));
  if (!okMethod || !sub) return res.status(404).json({ error: "not_found", code: "not_found", message: "Not found" });

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
      const body = rewritePlaylist(await up.text(), token, cfg.baseUrl);
      if (cfg.apiKey && body.includes(cfg.apiKey)) {
        res.removeHeader("content-length"); res.removeHeader("content-type"); res.removeHeader("etag");
        console.warn("[jellyfin-proxy] playlist still contained the server key; refused");
        return res.status(502).json({ error: "bad_playlist", code: "bad_playlist", message: "Playlist refused" });
      }
      res.removeHeader("content-length");
      res.setHeader("content-length", Buffer.byteLength(body));
      return res.end(body);
    } catch (e) { console.warn("[jellyfin-proxy] playlist read failed:", e?.message); return res.destroy(); }
  }
  const stream = Readable.fromWeb(up.body);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}
