// THE LOOKUP IS THE LEAST RELIABLE LINK IN THE BROWSER, and these pin the two
// ways it was failing in the wild.
//
// Measured 2026-09-10: five serial lookups 400ms apart returned 429 · 429 · 429
// · 429 · 200. There was no retry. And archive.org answers a rate limit with an
// HTML error page — one observed variant carrying HTTP 200 — which walked past
// `if (!res.ok)` into `res.json()` and reached the user as `Unexpected token '<'`.
//
// It matters because ~54% of this library's bookmarks resolve to a mode that
// depends on this answer, and for the Washington Post the snapshot is the ONLY
// thing that renders.
import { describe, it, expect, vi } from "vitest";
import { fetchWaybackSnapshot, retryAfterMs } from "../utils/waybackSnapshot.js";

const FOUND = {
  archived_snapshots: { closest: { status: "200", available: true, timestamp: "20231205055428",
    url: "http://web.archive.org/web/20231205055428/https://www.washingtonpost.com/x" } },
};
const res = (body, { status = 200, ok = status < 400, retryAfter = null } = {}) => ({
  ok, status,
  headers: { get: (k) => (String(k).toLowerCase() === "retry-after" ? retryAfter : null) },
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});
const noSleep = async () => {};

describe("fetchWaybackSnapshot", () => {
  it("retries a 429 and takes the answer — the measured failure", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(res("<html><body>too many requests</body></html>", { status: 429 }))
      .mockResolvedValueOnce(res(FOUND));
    const out = await fetchWaybackSnapshot("https://www.washingtonpost.com/x", { fetchImpl, sleep: noSleep });
    expect(out.ok).toBe(true);
    expect(out.url).toMatch(/^https:\/\/web\.archive\.org\//);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // THE ONE THAT REACHED THE USER AS `Unexpected token '<'`.
  it("treats an HTML body on a 200 as a reason, never a thrown parse error", async () => {
    const fetchImpl = vi.fn(async () => res("<html><body>slow down</body></html>"));
    const out = await fetchWaybackSnapshot("https://a.test", { fetchImpl, sleep: noSleep });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/busy/i);
    expect(out.reason).not.toMatch(/token|JSON|Unexpected/i);
  });

  it("honours Retry-After when the archive names one", async () => {
    const waits = [];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(res("", { status: 429, retryAfter: "1" }))
      .mockResolvedValueOnce(res(FOUND));
    const out = await fetchWaybackSnapshot("https://a.test", {
      fetchImpl, sleep: async (ms) => { waits.push(ms); },
    });
    expect(out.ok).toBe(true);
    expect(waits).toEqual([1000]);
  });

  it("clamps a hostile Retry-After — the archive cannot park us for a minute", () => {
    expect(retryAfterMs("120")).toBe(2000);
    expect(retryAfterMs("1")).toBe(1000);
    expect(retryAfterMs(null)).toBe(null);
    expect(retryAfterMs("nonsense")).toBe(null);
  });

  // THE CONTROL. Without it, "retries when busy" is equally satisfied by a
  // lookup that retries EVERYTHING — tripling the traffic to the service that
  // is rate-limiting us, which is the opposite of the fix.
  it("does NOT retry a 404 — that is an answer, not a rate limit", async () => {
    const fetchImpl = vi.fn(async () => res("", { status: 404 }));
    const out = await fetchWaybackSnapshot("https://a.test", { fetchImpl, sleep: noSleep });
    expect(out.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // AND "never archived" must stay distinguishable from "the archive is down",
  // or someone is told their page was never saved when the service was busy.
  it("keeps NEVER ARCHIVED apart from BUSY", async () => {
    const never = await fetchWaybackSnapshot("https://a.test", {
      fetchImpl: async () => res({ archived_snapshots: {} }), sleep: noSleep,
    });
    const busy = await fetchWaybackSnapshot("https://a.test", {
      fetchImpl: async () => res("<html>no</html>", { status: 429 }), sleep: noSleep,
    });
    expect(never.reason).toMatch(/no snapshot/i);
    expect(busy.reason).toMatch(/busy/i);
    expect(never.reason).not.toBe(busy.reason);
  });

  it("gives up inside ONE budget rather than per attempt", async () => {
    const fetchImpl = vi.fn(async () => res("", { status: 429 }));
    const t0 = Date.now();
    const out = await fetchWaybackSnapshot("https://a.test", {
      fetchImpl, totalMs: 120, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    });
    expect(out.ok).toBe(false);
    expect(Date.now() - t0).toBeLessThan(400);
  });

  it("never throws — a caller wants a reason to show, not an exception", async () => {
    const out = await fetchWaybackSnapshot("https://a.test", {
      fetchImpl: async () => { throw new Error("socket hang up"); }, sleep: noSleep,
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toContain("socket hang up");
  });
});
