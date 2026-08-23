// The `wayback_lookup` handler. The decisions live in `waybackSnapshot.js`;
// what is pinned HERE is what only the handler can get wrong — who may ask,
// what host is contacted, and telling "the archive is down" apart from "this
// page was never archived".
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerImportHandlers } from "../socketHandlers/import.js";

function fakeSocket({ userId = "u1" } = {}) {
  const handlers = new Map();
  return {
    userId,
    on: (ev, fn) => handlers.set(ev, fn),
    emit: vi.fn(),
    call: (ev, payload) => new Promise((res) => handlers.get(ev)(payload, res)),
    has: (ev) => handlers.has(ev),
  };
}
function register(socket) {
  registerImportHandlers(socket, { io: { to: () => ({ emit: () => {} }) }, userRoom: () => "r" });
  return socket;
}
const FOUND = {
  archived_snapshots: { closest: { status: "200", available: true, timestamp: "20260817224150",
    url: "http://web.archive.org/web/20260817224150/https://danbrown.com/" } },
};

let realFetch;
beforeEach(() => { realFetch = global.fetch; });
afterEach(() => { global.fetch = realFetch; });

describe("wayback_lookup", () => {
  it("is registered", () => {
    expect(register(fakeSocket()).has("wayback_lookup")).toBe(true);
  });

  it("returns the snapshot, https-upgraded", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => FOUND }));
    const out = await register(fakeSocket()).call("wayback_lookup", { url: "https://danbrown.com" });
    expect(out.ok).toBe(true);
    expect(out.url).toMatch(/^https:\/\/web\.archive\.org\//);
    expect(out.capturedAt).toBe("2026-08-17T22:41:50.000Z");
  });

  it("ONLY EVER CONTACTS archive.org — the reason it needs no SSRF guard", async () => {
    // The user's url is a query VALUE, never the host. This test is what makes
    // that claim true rather than merely intended: an internal address handed
    // in must not become the thing fetched.
    const seen = [];
    global.fetch = vi.fn(async (u) => { seen.push(u); return { ok: true, status: 200, json: async () => FOUND }; });
    await register(fakeSocket()).call("wayback_lookup", { url: "http://169.254.169.254/latest/meta-data/" });
    expect(seen).toHaveLength(1);
    expect(new URL(seen[0]).host).toBe("archive.org");
    expect(seen[0]).toContain(encodeURIComponent("http://169.254.169.254/latest/meta-data/"));
  });

  it("refuses an unauthenticated socket, and asks nothing", async () => {
    global.fetch = vi.fn();
    const out = await register(fakeSocket({ userId: null })).call("wayback_lookup", { url: "https://a.test" });
    expect(out.ok).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("requires a url", async () => {
    global.fetch = vi.fn();
    expect((await register(fakeSocket()).call("wayback_lookup", {})).ok).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("tells THE ARCHIVE IS DOWN apart from NEVER ARCHIVED", async () => {
    // Both are `ok: false`, and collapsing them would tell someone their page
    // isn't archived when the service was merely unavailable.
    global.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const down = await register(fakeSocket()).call("wayback_lookup", { url: "https://a.test" });
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ archived_snapshots: {} }) }));
    const never = await register(fakeSocket()).call("wayback_lookup", { url: "https://a.test" });
    expect(down.reason).toContain("503");
    expect(never.reason).toMatch(/no snapshot/i);
    expect(down.reason).not.toBe(never.reason);
  });

  it("reports a timeout as a timeout", async () => {
    global.fetch = vi.fn(async () => { const e = new Error("x"); e.name = "TimeoutError"; throw e; });
    const out = await register(fakeSocket()).call("wayback_lookup", { url: "https://a.test" });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/timed out/i);
  });

  it("survives a body that is not JSON", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } }));
    const out = await register(fakeSocket()).call("wayback_lookup", { url: "https://a.test" });
    expect(out.ok).toBe(false);
  });

  it("also emits the result with its requestId, like its neighbours", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => FOUND }));
    const s = register(fakeSocket());
    await s.call("wayback_lookup", { url: "https://a.test", requestId: "7" });
    expect(s.emit).toHaveBeenCalledWith("wayback_lookup_result", expect.objectContaining({ requestId: "7", ok: true }));
  });
});
