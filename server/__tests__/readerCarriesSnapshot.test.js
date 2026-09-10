// ONE ROUND TRIP, NOT TWO.
//
// The client used to learn "this page cannot be shown" from `page_reader` and
// then spend a SECOND round trip on `wayback_lookup`. Measured 2026-09-10 over
// 60 of the user's own bookmarks, that is the COMMON path: 35% refuse framing
// outright and 18% cannot be fetched at all — more than half of every open — and
// the two waits were strictly serial.
//
// The server already holds the framing verdict and the word count the moment the
// fetch returns, so it decides there and sends both.
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
const SNAP = { ok: true, url: "https://web.archive.org/web/2023/x", capturedAt: "2023-12-05T05:54:28.000Z" };
const page = (html) => ({ ok: true, html, url: "https://x.test/", xFrameOptions: null, csp: null });
const LONG = `<article>${"word ".repeat(400)}</article>`;

beforeEach(() => { fetchPageHtml.mockReset(); fetchWaybackSnapshot.mockReset(); });

describe("page_reader carries the snapshot when nothing else will show", () => {
  it("looks one up when the page is unreadable AND refuses framing — the Washington Post", async () => {
    fetchPageHtml.mockResolvedValue({ ...page("<p>thin</p>"), xFrameOptions: "SAMEORIGIN" });
    fetchWaybackSnapshot.mockResolvedValue(SNAP);
    const out = await register(socket()).call("page_reader", { url: "https://wapo.test/x" });
    expect(out.usable).toBe(false);
    expect(out.framable).toBe(false);
    expect(out.archive).toEqual(SNAP);
    expect(fetchWaybackSnapshot).toHaveBeenCalledTimes(1);
  });

  it("looks one up when the fetch failed outright", async () => {
    fetchPageHtml.mockResolvedValue({ ok: false, reason: "timed out after 6000ms" });
    fetchWaybackSnapshot.mockResolvedValue(SNAP);
    const out = await register(socket()).call("page_reader", { url: "https://dead.test/" });
    expect(out.ok).toBe(false);
    expect(out.archive).toEqual(SNAP);
  });

  // THE CONTROL, and it is the one that matters. Without it, "carries a snapshot"
  // is equally satisfied by looking one up for EVERY bookmark opened — which
  // would send a third party a request per open for a mode most opens never
  // need, and archive.org rate-limits hard enough to degrade the lookups that do.
  it("does NOT look one up when the page reads fine", async () => {
    fetchPageHtml.mockResolvedValue(page(LONG));
    const out = await register(socket()).call("page_reader", { url: "https://good.test/" });
    expect(out.usable).toBe(true);
    expect(out.archive).toBe(null);
    expect(fetchWaybackSnapshot).not.toHaveBeenCalled();
  });

  it("does NOT look one up when the page is thin but WILL frame", async () => {
    fetchPageHtml.mockResolvedValue(page("<p>thin</p>"));   // no x-frame-options
    const out = await register(socket()).call("page_reader", { url: "https://framable.test/" });
    expect(out.usable).toBe(false);
    expect(out.framable).toBe(true);
    expect(out.archive).toBe(null);
    expect(fetchWaybackSnapshot).not.toHaveBeenCalled();
  });

  // The lookup is a NICETY inside a wait someone is already sitting through, so
  // it must never be the thing that fails the read.
  it("still answers the read when the archive lookup throws", async () => {
    fetchPageHtml.mockResolvedValue({ ...page("<p>thin</p>"), xFrameOptions: "DENY" });
    fetchWaybackSnapshot.mockRejectedValue(new Error("archive exploded"));
    const out = await register(socket()).call("page_reader", { url: "https://x.test/" });
    expect(out.ok).toBe(true);
    expect(out.framable).toBe(false);
    expect(out.archive).toBe(null);
  });

  it("gives it a SHORTER leash than the standalone lookup", async () => {
    fetchPageHtml.mockResolvedValue({ ...page("<p>thin</p>"), xFrameOptions: "DENY" });
    fetchWaybackSnapshot.mockResolvedValue(SNAP);
    await register(socket()).call("page_reader", { url: "https://x.test/" });
    expect(fetchWaybackSnapshot.mock.calls[0][1].totalMs).toBeLessThan(8000);
  });
});
