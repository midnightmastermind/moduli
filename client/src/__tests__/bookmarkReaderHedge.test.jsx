// THE ARCHIVE LOOKUP STARTS BESIDE A STALLED LIVE READ (2026-09-13).
//
// Measured from the production droplet: the Washington Post holds the live
// reader fetch for the whole 6s deadline, and the archive lookup waited for that
// answer — so the article took ~10s to appear. Past READER_HEDGE_MS with no reply
// the lookup starts anyway. A page that answers quickly never reaches the hedge,
// so the lookup stays lazy for everything else.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";

vi.mock("../GridActionsContext.js", () => ({
  useGridActionsSelector: (sel) => sel({ fieldsById: {}, dispatch: vi.fn(), gridId: "g", userId: "u" }),
}));
vi.mock("../helpers/occurrenceUrl", () => ({
  occurrenceUrl: () => ({ url: "https://wapo.test/article", from: "field" }),
  hasViewableUrl: () => true,
}));
vi.mock("../helpers/embedUrl", () => ({ embedUrlFor: () => null }));

import BookmarkView, { READER_HEDGE_MS } from "../modules/BookmarkView.jsx";

const SNAP_URL = "https://web.archive.org/web/20231205055428/https://wapo.test/article";
const ARTICLE = "I'm working through a number of different theories about why House of Cards is so wrong.";

/** live: undefined = never answers (the stall); otherwise the reply. */
const socketFor = (live) => ({
  emit: vi.fn((ev, payload, ack) => {
    if (typeof ack !== "function") return;
    if (ev === "wayback_lookup") return ack({ ok: true, url: SNAP_URL, capturedAt: "2023-12-05T05:54:28.000Z" });
    if (ev === "import_plan") return ack({ ok: true, rootOccurrenceId: null, modules: [], occurrences: [] });
    if (ev !== "page_reader") return;
    if (payload.url === SNAP_URL) return ack({ ok: true, usable: true, markdown: ARTICLE, words: 1614 });
    if (live !== undefined) ack(live);
  }),
});
const emitted = (socket, ev) => socket.emit.mock.calls.filter(([e]) => e === ev);

const mount = async (socket, module = { kind: "bookmark", label: "House of Cards" }) => {
  let c;
  await act(async () => {
    c = render(<BookmarkView occurrence={{ id: "b1", fields: {}, meta: {} }} module={module} socket={socket} isActivePage />).container;
  });
  return c;
};
const advance = (ms) => act(async () => { vi.advanceTimersByTime(ms); });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("hedged archive lookup", () => {
  // THE CONTROL: before the hedge nothing is asked of archive.org.
  it("does not look for a snapshot before the hedge", async () => {
    const socket = socketFor(undefined);
    await mount(socket);
    await advance(READER_HEDGE_MS - 100);
    expect(emitted(socket, "wayback_lookup")).toHaveLength(0);
  });

  it("looks for the snapshot, and reads it, while the live read is still stalled", async () => {
    const socket = socketFor(undefined);
    const c = await mount(socket);
    const reader = [...c.querySelectorAll("button")].find((b) => b.textContent === "Reader");
    await act(async () => { fireEvent.click(reader); });
    await advance(READER_HEDGE_MS + 10);
    expect(emitted(socket, "wayback_lookup")).toHaveLength(1);
    expect(emitted(socket, "page_reader").some(([, p]) => p.url === SNAP_URL)).toBe(true);
    const plan = emitted(socket, "import_plan");
    expect(plan.length).toBeGreaterThan(0);
    expect(plan[plan.length - 1][1]).toMatchObject({ content: ARTICLE, title: "House of Cards" });
  });

  // THE OTHER CONTROL: a page that answers quickly and reads fine never touches
  // the archive, however long it stays open.
  it("a fast, readable live page never looks for a snapshot", async () => {
    const socket = socketFor({ ok: true, usable: true, framable: true, markdown: "live text", words: 900 });
    await mount(socket);
    await advance(READER_HEDGE_MS * 4);
    expect(emitted(socket, "wayback_lookup")).toHaveLength(0);
  });

  // user, 2026-09-13: *"we need a loading circle for magic and reader mode"*. The
  // pane used to print "no readable text" while the read was still out.
  it("Reader shows a loading circle, not a verdict, while the live read is out", async () => {
    const socket = socketFor(undefined);
    const c = await mount(socket);
    const reader = [...c.querySelectorAll("button")].find((b) => b.textContent === "Reader");
    await act(async () => { fireEvent.click(reader); });
    expect(c.querySelector("[data-reader-waiting]")).toBeTruthy();
    expect(c.textContent).not.toMatch(/no readable text/);
  });

  // THE CONTROL: a page that truly has no text anywhere still says so, rather
  // than spinning forever.
  it("a page with no text live or archived still gets the verdict", async () => {
    const socket = {
      emit: vi.fn((ev, payload, ack) => {
        if (typeof ack !== "function") return;
        if (ev === "wayback_lookup") return ack({ ok: false, reason: "not archived" });
        if (ev === "page_reader") return ack({ ok: false, error: "HTTP 403", usable: false });
      }),
    };
    const c = await mount(socket);
    const magic = [...c.querySelectorAll("button")].find((b) => b.textContent === "Magic");
    await act(async () => { fireEvent.click(magic); });
    await advance(10);
    expect(c.querySelector("[data-reader-waiting]")).toBeNull();
    expect(c.textContent).toMatch(/no readable text/);
  });

  it("with no pick, the snapshot shows as soon as it is found", async () => {
    const socket = socketFor(undefined);
    const c = await mount(socket);
    await advance(READER_HEDGE_MS + 10);
    expect(c.querySelector(`iframe[src="${SNAP_URL}"]`)).toBeTruthy();
  });
});
