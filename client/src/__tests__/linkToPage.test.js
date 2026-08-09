// "Convert this link to a page" (user, 2026-08-07). The gating decision is a
// pure function so the menu item can be tested without a DOM, and so the one
// rule that matters is explicit: only an EXTERNAL link converts. An in-app
// link already goes somewhere in the grid — converting it would duplicate a
// page that exists.
import { describe, it, expect, vi } from "vitest";
import { resolveExternalLink, canConvertLinkToPage, convertLinkToPage, harvestLinks } from "../helpers/linkToPage.js";

const occWith = (link) => ({ id: "o1", meta: link ? { link } : {} });

describe("resolveExternalLink", () => {
  it("returns the url for an external link", () => {
    expect(resolveExternalLink(occWith({ kind: "url", url: "https://example.com/a" })))
      .toBe("https://example.com/a");
  });

  it("treats a bare {url} with no kind as a url link", () => {
    expect(resolveExternalLink(occWith({ url: "http://example.com" }))).toBe("http://example.com");
  });

  it("REFUSES an in-app occurrence link", () => {
    // The whole point: it already goes somewhere in the grid.
    expect(resolveExternalLink(occWith({ kind: "occurrence", occId: "o2" }))).toBeNull();
  });

  it("refuses non-http schemes", () => {
    for (const url of ["file:///etc/passwd", "mailto:a@b.c", "javascript:alert(1)", "ftp://x/y"]) {
      expect(resolveExternalLink(occWith({ kind: "url", url })), url).toBeNull();
    }
  });

  it("refuses empty / missing links", () => {
    expect(resolveExternalLink(occWith(null))).toBeNull();
    expect(resolveExternalLink(occWith({ kind: "url", url: "   " }))).toBeNull();
    expect(resolveExternalLink(null, null)).toBeNull();
  });

  it("per-placement occurrence link wins over the template's", () => {
    const occ = occWith({ kind: "url", url: "https://occ.example" });
    const mod = { meta: { link: { kind: "url", url: "https://module.example" } } };
    expect(resolveExternalLink(occ, mod)).toBe("https://occ.example");
  });

  it("falls back to the template's link", () => {
    const mod = { meta: { link: { kind: "url", url: "https://module.example" } } };
    expect(resolveExternalLink(occWith(null), mod)).toBe("https://module.example");
  });

  it("canConvertLinkToPage mirrors it", () => {
    expect(canConvertLinkToPage(occWith({ kind: "url", url: "https://x.com" }))).toBe(true);
    expect(canConvertLinkToPage(occWith({ kind: "occurrence", occId: "o2" }))).toBe(false);
  });
});

describe("convertLinkToPage", () => {
  const mkSocket = () => {
    const handlers = {};
    return {
      emit: vi.fn(),
      on: vi.fn((ev, fn) => { handlers[ev] = fn; }),
      off: vi.fn(() => { delete handlers.import_url_result; }),
      _fire: (payload) => handlers.import_url_result?.(payload),
      _handlers: handlers,
    };
  };

  it("emits import_url and resolves with the server's answer", async () => {
    const socket = mkSocket();
    const p = convertLinkToPage({ socket, gridId: "g1", url: "https://example.com" });
    const [event, body] = socket.emit.mock.calls[0];
    expect(event).toBe("import_url");
    expect(body).toMatchObject({ gridId: "g1", url: "https://example.com" });

    socket._fire({ requestId: body.requestId, ok: true, rootOccurrenceId: "root-1" });
    await expect(p).resolves.toMatchObject({ ok: true, rootOccurrenceId: "root-1" });
  });

  it("ignores a result meant for a DIFFERENT convert", async () => {
    const socket = mkSocket();
    const p = convertLinkToPage({ socket, gridId: "g1", url: "https://example.com" });
    const { requestId } = socket.emit.mock.calls[0][1];

    socket._fire({ requestId: "someone-else", ok: true, rootOccurrenceId: "wrong" });
    socket._fire({ requestId, ok: true, rootOccurrenceId: "mine" });
    await expect(p).resolves.toMatchObject({ rootOccurrenceId: "mine" });
  });

  it("passes the server's REASON through, so the UI can say why", async () => {
    const socket = mkSocket();
    const p = convertLinkToPage({ socket, gridId: "g1", url: "https://example.com/a.pdf" });
    const { requestId } = socket.emit.mock.calls[0][1];
    socket._fire({ requestId, ok: false, error: "not a web page (content-type: application/pdf)" });
    await expect(p).resolves.toMatchObject({ ok: false, error: /not a web page/ });
  });

  it("times out rather than leaving a spinner running forever", async () => {
    vi.useFakeTimers();
    const socket = mkSocket();
    const p = convertLinkToPage({ socket, gridId: "g1", url: "https://example.com", timeoutMs: 100 });
    vi.advanceTimersByTime(101);
    await expect(p).resolves.toMatchObject({ ok: false, error: /timed out/ });
    expect(socket.off).toHaveBeenCalled();   // listener cleaned up
    vi.useRealTimers();
  });

  it("refuses to emit without a socket / gridId / url", async () => {
    await expect(convertLinkToPage({ gridId: "g1", url: "https://x.com" })).resolves.toMatchObject({ ok: false });
    const socket = mkSocket();
    await expect(convertLinkToPage({ socket, url: "https://x.com" })).resolves.toMatchObject({ ok: false });
    expect(socket.emit).not.toHaveBeenCalled();
  });
});

describe("harvestLinks", () => {
  const mkSocket = () => {
    const handlers = {};
    return {
      emit: vi.fn(),
      on: vi.fn((ev, fn) => { handlers[ev] = fn; }),
      off: vi.fn(() => { delete handlers.link_harvest_result; }),
      _fire: (payload) => handlers.link_harvest_result?.(payload),
    };
  };

  it("emits link_harvest and resolves with the list", async () => {
    const socket = mkSocket();
    const p = harvestLinks({ socket, url: "https://example.com" });
    const [event, body] = socket.emit.mock.calls[0];
    expect(event).toBe("link_harvest");
    expect(body).toMatchObject({ url: "https://example.com" });

    socket._fire({ requestId: body.requestId, ok: true, links: [{ url: "https://a", label: "A" }] });
    await expect(p).resolves.toMatchObject({ ok: true, links: [{ url: "https://a", label: "A" }] });
  });

  it("does NOT require a gridId — the server reads no grid to answer", async () => {
    const socket = mkSocket();
    harvestLinks({ socket, url: "https://example.com" });
    expect(socket.emit).toHaveBeenCalled();
  });

  it("ignores a result meant for a DIFFERENT harvest", async () => {
    // The follow-links route can have a harvest and several imports in flight
    // at once; answering to the wrong one imports the wrong pages.
    const socket = mkSocket();
    const p = harvestLinks({ socket, url: "https://example.com" });
    const { requestId } = socket.emit.mock.calls[0][1];
    socket._fire({ requestId: "someone-else", ok: true, links: [{ url: "https://wrong" }] });
    socket._fire({ requestId, ok: true, links: [{ url: "https://mine" }] });
    await expect(p).resolves.toMatchObject({ links: [{ url: "https://mine" }] });
  });

  it("passes the server's REASON through", async () => {
    const socket = mkSocket();
    const p = harvestLinks({ socket, url: "https://example.com" });
    const { requestId } = socket.emit.mock.calls[0][1];
    socket._fire({ requestId, ok: false, error: "timed out after 20000ms" });
    await expect(p).resolves.toMatchObject({ ok: false, error: /timed out/ });
  });

  it("times out rather than hanging the confirm list forever", async () => {
    vi.useFakeTimers();
    const socket = mkSocket();
    const p = harvestLinks({ socket, url: "https://example.com", timeoutMs: 100 });
    vi.advanceTimersByTime(101);
    await expect(p).resolves.toMatchObject({ ok: false, error: /timed out/ });
    expect(socket.off).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("refuses to emit without a socket or url", async () => {
    await expect(harvestLinks({ url: "https://x.com" })).resolves.toMatchObject({ ok: false });
    const socket = mkSocket();
    await expect(harvestLinks({ socket })).resolves.toMatchObject({ ok: false });
    expect(socket.emit).not.toHaveBeenCalled();
  });
});
