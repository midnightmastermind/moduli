// The pending page's decisions (ui/SharePending.jsx `fileShare`): which of the
// four entry points this is, what it posts, and that it never reports success
// it did not have (spec §12).
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
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
const stageFetch = () => vi.fn(async () => ({ status: 201, json: async () => ({ stageId: "st1", key: "key1" }) }));

beforeEach(() => { globalThis.caches = fakeCaches(); });

describe("fileShare", () => {
  // INVERTED 2026-09-29 (placement window). This used to assert that a stashed
  // share is POSTED to /api/v1/share and reported filed — the page ran the rules
  // itself. Every sender now reaches the placement window, so a link or text is
  // STAGED (same session Bearer) and the page redirects there; Auto in the
  // window runs those same rules.
  it("stages a stashed link with the session as Bearer, and redirects to the placement window", async () => {
    const fd = new FormData(); fd.append("url", "https://x.test/a"); fd.append("title", "A");
    await (await caches.open(SHARE_CACHE)).put(stashUrl("s1"), new Response(fd));
    const fetchImpl = stageFetch();
    const r = await fileShare({ fetchImpl, token: "session-jwt", location: loc("/share-pending?id=s1") });
    expect(r).toEqual({ ok: true, redirect: "/share-place?stage=st1&k=key1" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/v1/share/stage");
    expect(init.headers.Authorization).toBe("Bearer session-jwt");
    expect(JSON.parse(init.body)).toMatchObject({ url: "https://x.test/a", title: "A" });
  });

  it("the page follows the redirect", async () => {
    const fd = new FormData(); fd.append("url", "https://x.test/b");
    await (await caches.open(SHARE_CACHE)).put(stashUrl("s5"), new Response(fd));
    localStorage.setItem("moduli-token", "t");
    global.fetch = stageFetch();
    const assign = vi.fn();
    const orig = window.location;
    delete window.location;
    window.location = { ...orig, pathname: "/share-pending", search: "?id=s5", assign };
    const { default: SharePending } = await import("../ui/SharePending");
    render(<SharePending />);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/share-place?stage=st1&k=key1"));
    window.location = orig;
    localStorage.removeItem("moduli-token");
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
    const fetchImpl = stageFetch();
    await fileShare({ fetchImpl, token: "t", location: loc("/share-target?url=" + encodeURIComponent("webcal://cal.test/me.ics")) });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).url).toBe("webcal://cal.test/me.ics");
  });

  // A FILE reaches the window too (user, 2026-09-30: "i dont want anything
  // going through auto unless i express that in the dropdown (so images, other
  // things, etc, not just links)"). It used to POST straight to /api/v1/share,
  // which ran the rules — a shared photo never saw the window.
  it("a shared PHOTO is staged (multipart) and goes to the placement window, not the rules", async () => {
    // Delivered through launchQueue: jsdom cannot round-trip a File through the
    // fake cache's Response, and the entry point is not what is under test.
    const launchQueue = { setConsumer: (fn) => fn({ files: [{ getFile: async () => new File(["PNG"], "cat.png", { type: "image/png" }) }] }) };
    const fetchImpl = stageFetch();
    const r = await fileShare({ fetchImpl, token: "t", location: loc("/share-target"), launchQueue });
    expect(r).toEqual({ ok: true, redirect: "/share-place?stage=st1&k=key1" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/v1/share/stage");
    expect(init.body.get("files").name).toBe("cat.png");
  });

  it("Windows 'Open with': files from launchQueue are shared", async () => {
    const launchQueue = { setConsumer: (fn) => fn({ files: [{ getFile: async () => new File(["BEGIN:VCALENDAR"], "m.ics", { type: "text/calendar" }) }] }) };
    const fetchImpl = stageFetch();
    await fileShare({ fetchImpl, token: "t", location: loc("/share-target"), launchQueue });
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/v1/share/stage");
    expect(fetchImpl.mock.calls[0][1].body.get("files").name).toBe("m.ics");
  });

  it("sends the grid this device last had open as the fallback", async () => {
    localStorage.setItem("moduli-gridId", "g-last");
    const fd = new FormData(); fd.append("text", "x");
    await (await caches.open(SHARE_CACHE)).put(stashUrl("s4"), new Response(fd));
    const fetchImpl = stageFetch();
    await fileShare({ fetchImpl, token: "t", location: loc("/share-pending?id=s4") });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).fallbackGridId).toBe("g-last");
    localStorage.removeItem("moduli-gridId");
  });

  it("a failed stage is reported, not dressed up as done", async () => {
    const fd = new FormData(); fd.append("text", "x");
    await (await caches.open(SHARE_CACHE)).put(stashUrl("s3"), new Response(fd));
    const fetchImpl = vi.fn(async () => ({ status: 409, json: async () => ({ error: "no_destination", message: "this grid has no Files folder" }) }));
    const r = await fileShare({ fetchImpl, token: "t", location: loc("/share-pending?id=s3") });
    expect(r).toMatchObject({ ok: false, message: "this grid has no Files folder" });
  });
});
