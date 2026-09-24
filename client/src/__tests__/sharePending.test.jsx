// The pending page's decisions (ui/SharePending.jsx `fileShare`): which of the
// four entry points this is, what it posts, and that it never reports success
// it did not have (spec §12).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fileShare } from "../ui/SharePending";
import { SHARE_CACHE, stashUrl } from "../helpers/shareHandoff";

function fakeCaches() {
  const m = new Map();
  return { open: async () => ({
    put: async (k, r) => m.set(k, r), match: async (k) => m.get(k)?.clone(), delete: async (k) => m.delete(k),
  }) };
}
const loc = (path) => { const u = new URL(`https://viafluere.com${path}`); return { pathname: u.pathname, search: u.search }; };
const landed = { label: "x", ran: [{ ruleName: "Share: anything else", ok: true, created: [{ occurrenceId: "o", status: "created" }] }] };
const okFetch = () => vi.fn(async () => ({ status: 201, json: async () => landed }));

beforeEach(() => { globalThis.caches = fakeCaches(); });

describe("fileShare", () => {
  it("posts a stashed share with the session as Bearer, and reports it filed", async () => {
    const fd = new FormData(); fd.append("url", "https://x.test/a"); fd.append("title", "A");
    await (await caches.open(SHARE_CACHE)).put(stashUrl("s1"), new Response(fd));
    const fetchImpl = okFetch();
    const r = await fileShare({ fetchImpl, token: "session-jwt", location: loc("/share-pending?id=s1") });
    expect(r.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/v1/share");
    expect(init.headers.Authorization).toBe("Bearer session-jwt");
    expect(init.body.get("url")).toBe("https://x.test/a");
  });

  it("signed out: says to sign in, and posts nothing", async () => {
    const fd = new FormData(); fd.append("text", "hi");
    await (await caches.open(SHARE_CACHE)).put(stashUrl("s2"), new Response(fd));
    const fetchImpl = okFetch();
    const r = await fileShare({ fetchImpl, token: null, location: loc("/share-pending?id=s2") });
    expect(r).toMatchObject({ ok: false, needsSignIn: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a stash already used (a reload) says so instead of posting nothing silently", async () => {
    const r = await fileShare({ fetchImpl: okFetch(), token: "t", location: loc("/share-pending?id=gone") });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/already filed/);
  });

  it("shows the worker's or server's error", async () => {
    const r = await fileShare({ fetchImpl: okFetch(), token: "t", location: loc("/share-pending?error=Moduli%20wasn't%20ready") });
    expect(r.message).toBe("Moduli wasn't ready");
  });

  it("a webcal:// link (protocol handler) is shared as a url", async () => {
    const fetchImpl = okFetch();
    await fileShare({ fetchImpl, token: "t", location: loc("/share-target?url=" + encodeURIComponent("webcal://cal.test/me.ics")) });
    expect(fetchImpl.mock.calls[0][1].body.get("url")).toBe("webcal://cal.test/me.ics");
  });

  it("Windows 'Open with': files from launchQueue are shared", async () => {
    const launchQueue = { setConsumer: (fn) => fn({ files: [{ getFile: async () => new File(["BEGIN:VCALENDAR"], "m.ics", { type: "text/calendar" }) }] }) };
    const fetchImpl = okFetch();
    await fileShare({ fetchImpl, token: "t", location: loc("/share-target"), launchQueue });
    expect(fetchImpl.mock.calls[0][1].body.get("files").name).toBe("m.ics");
  });

  it("sends the grid this device last had open as the fallback", async () => {
    localStorage.setItem("moduli-gridId", "g-last");
    const fd = new FormData(); fd.append("text", "x");
    await (await caches.open(SHARE_CACHE)).put(stashUrl("s4"), new Response(fd));
    const fetchImpl = okFetch();
    await fileShare({ fetchImpl, token: "t", location: loc("/share-pending?id=s4") });
    expect(fetchImpl.mock.calls[0][1].body.get("fallbackGridId")).toBe("g-last");
    localStorage.removeItem("moduli-gridId");
  });

  it("a failed share is reported, not dressed up as done", async () => {
    const fd = new FormData(); fd.append("text", "x");
    await (await caches.open(SHARE_CACHE)).put(stashUrl("s3"), new Response(fd));
    const fetchImpl = vi.fn(async () => ({ status: 409, json: async () => ({ error: "no_destination", message: "this grid has no Files folder" }) }));
    const r = await fileShare({ fetchImpl, token: "t", location: loc("/share-pending?id=s3") });
    expect(r).toMatchObject({ ok: false, message: "this grid has no Files folder" });
  });
});
