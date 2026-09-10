// "Convert this link to a page" makes the SERVER fetch a URL the user supplies,
// which is a classic SSRF hole: the server sits inside the network and can
// reach what the user cannot — the database host, an admin port, or a cloud
// metadata endpoint at 169.254.169.254 that hands out credentials.
//
// These tests are the guard's spec. They lean on the DENY side deliberately:
// every case that should be refused is asserted individually, because a hole
// here is silent and remote.
import { describe, it, expect, vi } from "vitest";
import { isBlockedHost, validateFetchUrl, fetchPageHtml } from "../utils/safeFetchUrl.js";

describe("isBlockedHost", () => {
  it("blocks loopback in every spelling", () => {
    for (const h of ["localhost", "LOCALHOST", "app.localhost", "127.0.0.1", "127.1.2.3", "::1", "::ffff:127.0.0.1"]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it("blocks the cloud metadata endpoint", () => {
    // The one that hands out IAM credentials. Non-negotiable.
    expect(isBlockedHost("169.254.169.254")).toBe(true);
  });

  it("blocks every RFC1918 range", () => {
    for (const h of ["10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1"]) {
      expect(isBlockedHost(h), h).toBe(true);
    }
  });

  it("does NOT block public addresses that merely look close", () => {
    // 172.15 and 172.32 sit just outside RFC1918 — an off-by-one here would
    // block real sites, which is how guards get weakened later.
    for (const h of ["8.8.8.8", "172.15.0.1", "172.32.0.1", "193.168.1.1", "example.com"]) {
      expect(isBlockedHost(h), h).toBe(false);
    }
  });

  it("blocks IPv6 unique-local and link-local", () => {
    expect(isBlockedHost("fd00::1")).toBe(true);
    expect(isBlockedHost("fe80::1")).toBe(true);
    expect(isBlockedHost("[fd00::1]")).toBe(true);
  });

  it("blocks internal-looking suffixes and empty input", () => {
    expect(isBlockedHost("db.internal")).toBe(true);
    expect(isBlockedHost("printer.local")).toBe(true);
    expect(isBlockedHost("")).toBe(true);
    expect(isBlockedHost(null)).toBe(true);
  });
});

describe("validateFetchUrl", () => {
  it("accepts ordinary http(s) pages", () => {
    expect(validateFetchUrl("https://en.wikipedia.org/wiki/Eminem").ok).toBe(true);
    expect(validateFetchUrl("http://example.com/a?b=c").ok).toBe(true);
  });

  it("refuses non-web schemes", () => {
    for (const u of ["file:///etc/passwd", "gopher://x", "data:text/html,<b>x", "ftp://x/y"]) {
      const r = validateFetchUrl(u);
      expect(r.ok, u).toBe(false);
      expect(r.reason).toMatch(/scheme/);
    }
  });

  it("refuses a private destination", () => {
    const r = validateFetchUrl("http://127.0.0.1:27017/");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/private|loopback/);
  });

  it("refuses garbage", () => {
    expect(validateFetchUrl("not a url").ok).toBe(false);
    expect(validateFetchUrl("").ok).toBe(false);
  });
});

describe("fetchPageHtml", () => {
  const okRes = (html, type = "text/html") => ({
    ok: true, status: 200,
    headers: { get: (k) => (k.toLowerCase() === "content-type" ? type : null) },
    text: async () => html,
  });

  it("returns the html for a good page", async () => {
    const fetchImpl = vi.fn(async () => okRes("<h1>Hi</h1>"));
    const r = await fetchPageHtml("https://example.com", { fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.html).toBe("<h1>Hi</h1>");
  });

  it("NEVER dials a blocked host — the guard runs before the request", async () => {
    const fetchImpl = vi.fn();
    const r = await fetchPageHtml("http://169.254.169.254/latest/meta-data/", { fetchImpl });
    expect(r.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();   // the assertion that matters
  });

  // Redirects are followed BY HAND. Letting fetch follow them lands wherever
  // the chain ends; refusing them outright breaks real links (measured: MDN
  // 301s, and HTTP→HTTPS redirects are everywhere). Each hop is re-validated.
  const redirectTo = (loc, status = 302) => ({
    ok: false, status,
    headers: { get: (k) => (k.toLowerCase() === "location" ? loc : null) },
    text: async () => "",
  });

  it("never delegates redirect-following to fetch", async () => {
    const fetchImpl = vi.fn(async () => okRes("<p>ok</p>"));
    await fetchPageHtml("https://example.com", { fetchImpl });
    expect(fetchImpl.mock.calls[0][1].redirect).toBe("manual");
  });

  it("FOLLOWS a redirect to a public destination", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(redirectTo("https://example.com/final", 301))
      .mockResolvedValueOnce(okRes("<h1>Final</h1>"));
    const r = await fetchPageHtml("https://example.com/start", { fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.html).toBe("<h1>Final</h1>");
    expect(r.url).toBe("https://example.com/final");   // reports where it ended
  });

  it("resolves a RELATIVE Location (the MDN case)", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(redirectTo("/en-US/docs/Reference/404", 301))
      .mockResolvedValueOnce(okRes("<h1>404</h1>"));
    const r = await fetchPageHtml("https://developer.mozilla.org/en-US/docs/Status/404", { fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.url).toBe("https://developer.mozilla.org/en-US/docs/Reference/404");
  });

  it("RE-VALIDATES each hop — a redirect into the private range is refused", async () => {
    // The attack this whole loop exists to stop.
    const fetchImpl = vi.fn().mockResolvedValueOnce(redirectTo("http://169.254.169.254/latest/meta-data/"));
    const r = await fetchPageHtml("https://example.com", { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/private|loopback/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);   // never dialled the metadata host
  });

  it("stops a redirect loop", async () => {
    const fetchImpl = vi.fn(async () => redirectTo("https://example.com/loop"));
    const r = await fetchPageHtml("https://example.com/loop", { fetchImpl, maxRedirects: 3 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/too many redirects/);
    expect(fetchImpl).toHaveBeenCalledTimes(4);   // initial + 3 hops, then stop
  });

  it("refuses a redirect with no Location", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 302, headers: { get: () => null }, text: async () => "" }));
    const r = await fetchPageHtml("https://example.com", { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no Location/);
  });

  it("refuses a non-page content type", async () => {
    const fetchImpl = vi.fn(async () => okRes("%PDF-1.4", "application/pdf"));
    const r = await fetchPageHtml("https://example.com/a.pdf", { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not a web page/);
  });

  it("caps the body so a huge response cannot exhaust memory", async () => {
    const fetchImpl = vi.fn(async () => okRes("x".repeat(5000)));
    const r = await fetchPageHtml("https://example.com", { fetchImpl, maxBytes: 1000 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/too large/);
  });

  it("reports a non-200 rather than importing an error page", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404, headers: { get: () => null }, text: async () => "" }));
    const r = await fetchPageHtml("https://example.com/missing", { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/404/);
  });

  it("reports a timeout", async () => {
    const fetchImpl = vi.fn(async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; });
    const r = await fetchPageHtml("https://example.com", { fetchImpl, timeoutMs: 5 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/timed out/);
  });
});

// ── WHICH USER-AGENT ────────────────────────────────────────────────────────
//
// Measured on the user's own bookmarks (2026-09-10): the Washington Post TARPITS
// our plain agent — 14,792ms and no answer — and serves a browser agent 987KB in
// 151ms. `kickstarter.com` is the exact inverse: 200 plain, 403 on Chrome's.
//
// So the order is decided by the COST OF BEING WRONG rather than by which agent
// is more often right, and these pin that reasoning rather than the strings.
describe("fetchPageHtml — the two user-agents", () => {
  const okRes = (html, type = "text/html") => ({
    ok: true, status: 200,
    headers: { get: (k) => (k.toLowerCase() === "content-type" ? type : null) },
    text: async () => html,
  });
  const status = (code) => ({
    ok: false, status: code,
    headers: { get: () => null },
    text: async () => "",
  });
  const uaOf = (call) => call[1].headers["User-Agent"];

  it("asks as a BROWSER first — the tarpit case", async () => {
    const fetchImpl = vi.fn(async () => okRes("<h1>Hi</h1>"));
    await fetchPageHtml("https://www.washingtonpost.com/x", { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(uaOf(fetchImpl.mock.calls[0])).toMatch(/Chrome\/\d/);
  });

  it("retries as ITSELF when the site refuses the browser agent — the kickstarter case", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(status(403))
      .mockResolvedValueOnce(okRes("<p>real page</p>"));
    const r = await fetchPageHtml("https://www.kickstarter.com/", { fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.html).toBe("<p>real page</p>");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(uaOf(fetchImpl.mock.calls[0])).toMatch(/Chrome\/\d/);
    expect(uaOf(fetchImpl.mock.calls[1])).toMatch(/Moduli/);
  });

  // THE CONTROL. Without it, "retries on a refusal" is equally satisfied by a
  // fetch that retries EVERYTHING — which would double every dead link on the
  // board, and there are plenty (measured: 11 of 60 are a plain 404).
  it("does NOT retry a 404 — only the agent-shaped refusals", async () => {
    const fetchImpl = vi.fn(async () => status(404));
    const r = await fetchPageHtml("https://example.com/gone", { fetchImpl });
    expect(r.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports the FIRST answer when both agents are refused", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(status(403))
      .mockResolvedValueOnce(status(401));
    const r = await fetchPageHtml("https://example.com/locked", { fetchImpl });
    expect(r.ok).toBe(false);
    // 403, not 401 — the browser agent is what most sites are answering.
    expect(r.reason).toContain("403");
  });

  // THE LOAD-BEARING ONE. Two attempts must never cost more wall time than one
  // was allowed, or this fixes a 15s hang by inventing a 12s one.
  //
  // IT HAS TO BURN THE BUDGET ON A **403**, and the A/B is why that is written
  // down: a first draft burned it on a TIMEOUT, which carries no `status`, so
  // the retry never fired and one attempt ran under either implementation. It
  // passed against a per-attempt budget — the exact thing it exists to catch.
  it("shares ONE deadline across both attempts", async () => {
    const slow403 = async (_u, opts) => {
      await new Promise((res, rej) => {
        const t = setTimeout(res, 200);
        opts.signal.addEventListener("abort", () => {
          clearTimeout(t);
          rej(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
      return { ok: false, status: 403, headers: { get: () => null }, text: async () => "" };
    };
    const fetchImpl = vi.fn(slow403);
    const t0 = Date.now();
    await fetchPageHtml("https://example.com/slow", { fetchImpl, timeoutMs: 250 });
    const elapsed = Date.now() - t0;
    // Shared: 200ms burnt, ~50ms left for the retry -> ~250ms total.
    // Per-attempt: 200ms + a fresh 200ms -> ~400ms.
    expect(elapsed).toBeLessThan(320);
  });
});
