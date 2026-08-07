// utils/safeFetchUrl.js
//
// "Convert this link to a page" makes the SERVER fetch a URL the user supplies.
// That is a classic SSRF hole: the server sits inside the network and can reach
// things the user cannot — the Mongo host, the pm2 admin port, a cloud
// metadata endpoint at 169.254.169.254 that hands out credentials.
//
// So the URL is validated BEFORE any request goes out, and the rule is an
// ALLOWLIST of scheme plus a DENYLIST of destination:
//
//   • http/https only — no file://, no gopher://, no data:
//   • no loopback, no private ranges, no link-local, no unique-local v6
//
// This mirrors the posture the assistant bootstrap-token endpoint already
// takes (server/routes/apiV1.js), just in the opposite direction: that one
// decides who may ASK, this one decides what may be REACHED.
//
// KNOWN LIMIT, stated rather than hidden: this validates the URL the user gave
// us. A public hostname that RESOLVES to a private address, or a 302 to one,
// is not caught here — closing that needs resolve-then-pin-the-socket, which
// Node's fetch does not expose. `redirect: "manual"` below means we never
// silently follow a redirect into the private range; a redirected URL is
// re-validated by the caller or refused.

const PRIVATE_V4 = [
  /^0\./,                       // "this network"
  /^10\./,                      // RFC1918
  /^127\./,                     // loopback
  /^169\.254\./,                // link-local — includes cloud metadata
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918
  /^192\.168\./,                // RFC1918
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT
  /^198\.(1[89])\./,            // benchmarking
  /^22[4-9]\./, /^2[3-5]\d\./,  // multicast + reserved
];

/** Is this hostname one we must never let the server reach? */
export function isBlockedHost(hostname) {
  const h = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;

  // IPv6 loopback / unique-local (fc00::/7) / link-local (fe80::/10)
  if (h === "::1" || h === "::") return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(h)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(h)) return true;
  // IPv4-mapped IPv6 (::ffff:127.0.0.1) — check the embedded v4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(h);
  if (mapped) return isBlockedHost(mapped[1]);

  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return PRIVATE_V4.some((re) => re.test(h));
  return false;
}

/**
 * Validate a user-supplied URL for server-side fetching.
 * @returns {{ ok: true, url: URL } | { ok: false, reason: string }}
 */
export function validateFetchUrl(raw) {
  let url;
  try { url = new URL(String(raw || "").trim()); }
  catch { return { ok: false, reason: "not a valid URL" }; }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `unsupported scheme "${url.protocol}" — only http and https` };
  }
  if (isBlockedHost(url.hostname)) {
    return { ok: false, reason: "refuses to fetch a private, loopback or link-local address" };
  }
  return { ok: true, url };
}

/**
 * Fetch a page's HTML with the guard applied.
 * Caps the body so a huge or endless response cannot exhaust memory.
 */
export async function fetchPageHtml(raw, { timeoutMs = 20000, maxBytes = 5 * 1024 * 1024, fetchImpl } = {}) {
  const v = validateFetchUrl(raw);
  if (!v.ok) return { ok: false, reason: v.reason };

  const doFetch = fetchImpl || globalThis.fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await doFetch(v.url.toString(), {
      signal: ac.signal,
      // Never follow automatically — a 302 into 127.0.0.1 would walk straight
      // through the check we just did.
      redirect: "manual",
      headers: {
        // Some sites serve a stub to unknown agents; this is the same posture
        // services/wikipediaTools.js already takes.
        "User-Agent": "Mozilla/5.0 (compatible; Moduli/1.0; +https://viafluere.com)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const to = res.headers?.get?.("location");
      return { ok: false, reason: `redirected (${res.status})${to ? ` to ${to}` : ""} — re-run with the final URL` };
    }
    if (!res.ok) return { ok: false, reason: `fetch failed (${res.status})` };

    const type = res.headers?.get?.("content-type") || "";
    if (type && !/text\/html|application\/xhtml|text\/plain/i.test(type)) {
      return { ok: false, reason: `not a web page (content-type: ${type})` };
    }

    const html = await res.text();
    if (html.length > maxBytes) {
      return { ok: false, reason: `page too large (${html.length} bytes, cap ${maxBytes})` };
    }
    return { ok: true, html, url: v.url.toString() };
  } catch (e) {
    if (e?.name === "AbortError") return { ok: false, reason: `timed out after ${timeoutMs}ms` };
    return { ok: false, reason: e?.message || "fetch failed" };
  } finally {
    clearTimeout(timer);
  }
}
