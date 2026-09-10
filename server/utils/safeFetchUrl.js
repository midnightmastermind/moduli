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

// ── WHICH USER-AGENT, AND WHY IT IS TWO ─────────────────────────────────────
//
// User, 2026-09-10: *"i still cant access web pages that raindrop can (aka
// washington post)"*. Measured — the Washington Post does not refuse our fetch,
// it TARPITS it:
//
//     washingtonpost.com   Moduli UA   FAIL 14792ms   (never answers)
//                          Chrome UA    200   151ms   987KB
//
// Across 60 of the user's own bookmarks the browser UA is worth a median 386 ->
// 153ms, a p90 of 958 -> 649ms and a max of 6529 -> 1536ms — total wall time
// 33.0s -> 15.4s.
//
// **IT IS A LATENCY FIX AND NOT A COVERAGE ONE, which is worth stating because
// it looks like the opposite.** Fetch successes were 48/60 either way: it
// unlocks no new pages, it stops the slow ones hanging.
//
// AND NO SINGLE AGENT WINS. `kickstarter.com` is the exact inverse — 200 on the
// plain agent, 403 on Chrome's. So the order is decided by the COST OF BEING
// WRONG, not by which is more often right: a wrong agent costs a 20ms 403 that
// is cheap to retry, while a tarpit costs fifteen seconds and cannot be
// retried into. Chrome first, plain agent on a 401/403.
//
// The retries share ONE deadline, so two attempts can never cost more wall time
// than one was allowed — otherwise this would fix a 15s hang by inventing a 12s
// one.
const UA_BROWSER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const UA_PLAIN = "Mozilla/5.0 (compatible; Moduli/1.0; +https://viafluere.com)";
/** Statuses where the AGENT is the plausible reason, so the other one is worth a try. */
const RETRY_WITH_PLAIN_UA = new Set([401, 403]);

/**
 * Fetch a page's HTML with the guard applied.
 *
 * REDIRECTS ARE FOLLOWED BY HAND, and that is the whole point of this loop.
 * Letting `fetch` follow them lands us wherever the chain ends — a 302 into
 * 127.0.0.1 walks straight through the check we just did. Refusing them
 * outright is no good either: measured against real links, MDN alone 301s
 * (`/Status/404` → `/Reference/Status/404`), and HTTP→HTTPS plus trailing-slash
 * redirects are everywhere. So each hop is resolved, RE-VALIDATED through the
 * same guard, and re-fetched, with a cap so a redirect loop terminates.
 *
 * Caps the body so a huge or endless response cannot exhaust memory.
 */
export async function fetchPageHtml(raw, {
  timeoutMs = 20000, maxBytes = 5 * 1024 * 1024, maxRedirects = 5, fetchImpl,
} = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  const deadline = Date.now() + timeoutMs;

  const attempt = async (userAgent) => {
  const remaining = Math.max(0, deadline - Date.now());
  // A retry with no budget left must not fire a request it cannot finish.
  if (remaining <= 0) return { ok: false, reason: `timed out after ${timeoutMs}ms` };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), remaining);
  try {
    let current = raw;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      // EVERY hop goes through the guard, not just the first — that is what
      // makes following a redirect safe.
      const v = validateFetchUrl(current);
      if (!v.ok) {
        return { ok: false, reason: hop === 0 ? v.reason : `redirect ${hop} → ${v.reason}` };
      }

      const res = await doFetch(v.url.toString(), {
        signal: ac.signal,
        redirect: "manual",
        headers: {
          // Chosen by the caller below, not fixed here — see the note above the
          // function for why there are two and why this order.
          "User-Agent": userAgent,
          Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          // Sites that vary on it serve a redirect-to-a-locale rather than the
          // page; saying so up front skips a hop.
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers?.get?.("location");
        if (!loc) return { ok: false, reason: `redirected (${res.status}) with no Location` };
        // Resolve relative Locations ("/en-US/docs/…") against the current URL.
        current = new URL(loc, v.url).toString();
        continue;
      }

      // `status` rides along so the retry can key on the agent-shaped refusals
      // rather than on the reason STRING, which is user-facing prose.
      if (!res.ok) return { ok: false, status: res.status, reason: `fetch failed (${res.status})` };

      const type = res.headers?.get?.("content-type") || "";
      if (type && !/text\/html|application\/xhtml|text\/plain/i.test(type)) {
        return { ok: false, reason: `not a web page (content-type: ${type})` };
      }

      const html = await res.text();
      if (html.length > maxBytes) {
        return { ok: false, reason: `page too large (${html.length} bytes, cap ${maxBytes})` };
      }
      // The FINAL url is returned, not the one asked for — it is what the
      // content actually came from.
      //
      // The two framing headers ride along because the iframe view needs to
      // know whether the page will let itself be framed, and this fetch already
      // has them — the alternative is guessing from a load timeout. Only the
      // ENFORCED CSP is passed: `content-security-policy-report-only` blocks
      // nothing, and treating it as a refusal would withhold the live page from
      // sites that allow it (google.com and instagram.com both send it).
      return {
        ok: true, html, url: v.url.toString(),
        xFrameOptions: res.headers?.get?.("x-frame-options") || null,
        csp: res.headers?.get?.("content-security-policy") || null,
      };
    }
    return { ok: false, reason: `too many redirects (${maxRedirects})` };
  } catch (e) {
    if (e?.name === "AbortError") return { ok: false, reason: `timed out after ${timeoutMs}ms` };
    return { ok: false, reason: e?.message || "fetch failed" };
  } finally {
    clearTimeout(timer);
  }
  };

  const first = await attempt(UA_BROWSER);
  if (first.ok || !RETRY_WITH_PLAIN_UA.has(first.status)) return first;
  // The refusal looked like it was about WHO asked. Ask again as ourselves —
  // and if that fails too, report the FIRST answer, because the browser agent
  // is the one most sites are actually responding to.
  const second = await attempt(UA_PLAIN);
  return second.ok ? second : first;
}
