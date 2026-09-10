// THE READ IS ANSWERED AS SOON AS IT IS READ.
//
// This handler briefly looked the archive snapshot up ITSELF and sent it in the
// same reply, so the common case (35% of this library refuses framing, 18%
// cannot be fetched at all) cost ONE round trip instead of two serial ones. The
// arithmetic was right and the change was wrong.
//
// User, 2026-09-10, using it: *"took too long"*. Awaiting the lookup pushed
// FIRST PAINT from ~363ms out to 1-4.4s — a person feels the first paint, not
// the total, and the round trip it bought back is ~50ms against a lookup costing
// 644ms-3.3s.
//
// These pin the retraction. The temptation to re-bundle it is real (the total
// really is lower), so the contract is written down rather than left as a
// comment: the reader NEVER blocks on a third party it does not need.
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchPageHtml = vi.fn();
const fetchWaybackSnapshot = vi.fn();
vi.mock("../utils/safeFetchUrl.js", () => ({ fetchPageHtml: (...a) => fetchPageHtml(...a) }));
vi.mock("../utils/waybackSnapshot.js", async (orig) => ({
  ...(await orig()),
  fetchWaybackSnapshot: (...a) => fetchWaybackSnapshot(...a),
}));

const { registerImportHandlers } = await import("../socketHandlers/import.js");

function socket() {
  const handlers = new Map();
  return {
    userId: "u1", emit: vi.fn(),
    on: (ev, fn) => handlers.set(ev, fn),
    call: (ev, payload) => new Promise((res) => handlers.get(ev)(payload, res)),
  };
}
const register = (s) => {
  registerImportHandlers(s, { io: { to: () => ({ emit: () => {} }) }, userRoom: () => "r" });
  return s;
};
const page = (html, xfo = null) => ({ ok: true, html, url: "https://x.test/", xFrameOptions: xfo, csp: null });

beforeEach(() => { fetchPageHtml.mockReset(); fetchWaybackSnapshot.mockReset(); });

describe("page_reader never waits on the archive", () => {
  it("asks for NO snapshot even when the page can show nothing — the case that tempted it", async () => {
    fetchPageHtml.mockResolvedValue(page("<p>thin</p>", "SAMEORIGIN"));
    const out = await register(socket()).call("page_reader", { url: "https://wapo.test/x" });
    expect(out.usable).toBe(false);
    expect(out.framable).toBe(false);
    expect(fetchWaybackSnapshot, "the reader is blocking on a third party again").not.toHaveBeenCalled();
  });

  it("asks for none when the fetch failed either", async () => {
    fetchPageHtml.mockResolvedValue({ ok: false, reason: "timed out after 6000ms" });
    const out = await register(socket()).call("page_reader", { url: "https://dead.test/" });
    expect(out.ok).toBe(false);
    expect(fetchWaybackSnapshot).not.toHaveBeenCalled();
  });

  // THE MEASUREMENT, AS A TEST. A slow lookup must not be able to delay the read
  // — which is exactly what it did. If someone re-adds the await, this is what
  // catches it, and it fails on the thing the user actually reported.
  it("answers promptly even when a snapshot lookup would be slow", async () => {
    fetchPageHtml.mockResolvedValue(page("<p>thin</p>", "DENY"));
    fetchWaybackSnapshot.mockImplementation(
      () => new Promise((r) => setTimeout(() => r({ ok: true, url: "https://web.archive.org/x" }), 3000)),
    );
    const t0 = Date.now();
    const out = await register(socket()).call("page_reader", { url: "https://slow.test/" });
    expect(out.ok).toBe(true);
    expect(Date.now() - t0, "the read waited on the archive").toBeLessThan(500);
  });

  // THE CONTROL. Without it, "never asks" is equally satisfied by the snapshot
  // feature being gone — and it is what makes the Washington Post readable.
  it("but wayback_lookup ITSELF still works — the client is what asks now", async () => {
    const SNAP = { ok: true, url: "https://web.archive.org/web/2023/x" };
    fetchWaybackSnapshot.mockResolvedValue(SNAP);
    const out = await register(socket()).call("wayback_lookup", { url: "https://wapo.test/x" });
    expect(out).toEqual(SNAP);
    expect(fetchWaybackSnapshot).toHaveBeenCalledTimes(1);
  });
});
