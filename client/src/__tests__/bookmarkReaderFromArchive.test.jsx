// THE READER FALLS BACK TO THE ARCHIVE.
//
// User, 2026-09-10: *"the reader view shows nothing for this bookmark
// currently... id like the reader to point at the archive if web fails"*.
//
// Measured on the article they named — the live page gives the masthead and
// nothing else, its SNAPSHOT gives the piece:
//
//     washingtonpost.com   live       91 words   (unusable)
//                          snapshot 1614 words   (the actual article)
//
// A page can be unreadable TODAY and perfectly readable in the archive, and for
// a paywalled or client-rendered news site that is the normal case. The snapshot
// was captured when the text was still in the HTML.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";

vi.mock("../GridActionsContext.js", () => ({
  useGridActionsSelector: (sel) => sel({ fieldsById: {}, dispatch: vi.fn(), gridId: "g", userId: "u" }),
}));
vi.mock("../helpers/occurrenceUrl", () => ({
  occurrenceUrl: () => ({ url: "https://wapo.test/article", from: "field" }),
  hasViewableUrl: () => true,
}));
vi.mock("../helpers/embedUrl", () => ({ embedUrlFor: () => null }));

import BookmarkView, { readerSource } from "../modules/BookmarkView.jsx";

const occurrence = { id: "b1", fields: {}, meta: {} };
const SNAP_URL = "https://web.archive.org/web/20231205055428/https://wapo.test/article";
const SNAP = { ok: true, url: SNAP_URL, capturedAt: "2023-12-05T05:54:28.000Z" };
const ARTICLE = "I'm working through a number of different theories about why House of Cards is so wrong.";

// The live page: masthead only, and it refuses framing — the real WaPo shape.
const LIVE_THIN = { ok: true, usable: false, framable: false, markdown: "Democracy Dies in Darkness", words: 91 };

/** Routes page_reader by URL: the live url is thin, the snapshot is the article. */
const socketFor = (live = LIVE_THIN, snapshot = SNAP) => ({
  emit: vi.fn((ev, payload, ack) => {
    if (typeof ack !== "function") return;
    if (ev === "wayback_lookup") return ack(snapshot);
    // Reader mode lays the text out through the IMPORTER's own planner now
    // (2026-09-12) rather than printing markdown source, so the reader is not
    // finished until this answers. The plan itself is exercised in
    // readerPlan.test.js / server importPlan.test.js; here it only has to reply.
    if (ev === "import_plan") return ack({ ok: true, rootOccurrenceId: null, modules: [], occurrences: [] });
    if (ev !== "page_reader") return;
    if (payload.url === SNAP_URL) return ack({ ok: true, usable: true, markdown: ARTICLE, words: 1614 });
    ack(live);
  }),
});

const openReader = async (socket) => {
  let c;
  await act(async () => {
    c = render(<BookmarkView occurrence={occurrence} module={{ kind: "bookmark" }} socket={socket} isActivePage />).container;
  });
  const btn = [...c.querySelectorAll("button")].find((b) => b.textContent === "Reader");
  await act(async () => { fireEvent.click(btn); });
  return c;
};

beforeEach(() => { vi.clearAllMocks(); });

describe("readerSource — which text the reader shows", () => {
  it("prefers the LIVE text whenever it is usable", () => {
    const r = readerSource({
      fetched: { ok: true, usable: true, markdown: "live text" },
      archiveRead: { ok: true, usable: true, markdown: "archive text" },
    });
    expect(r).toEqual({ markdown: "live text", from: "live" });
  });

  it("falls back to the archive when the live page has nothing", () => {
    const r = readerSource({
      fetched: LIVE_THIN,
      archiveRead: { ok: true, usable: true, markdown: ARTICLE },
    });
    expect(r.from).toBe("archive");
    expect(r.markdown).toBe(ARTICLE);
  });

  it("reports WAITING apart from having nothing", () => {
    expect(readerSource({ fetched: LIVE_THIN, archiveRead: { loading: true } }).from).toBe("loading");
    expect(readerSource({ fetched: LIVE_THIN, archiveRead: null }).from).toBe(null);
  });

  // THE CONTROL. A thin ARCHIVE must not be preferred over nothing and rendered
  // as if it were the article — that would replace an honest empty state with a
  // masthead.
  it("does not use an archive read that is ALSO thin", () => {
    const r = readerSource({
      fetched: LIVE_THIN,
      archiveRead: { ok: true, usable: false, markdown: "Democracy Dies in Darkness" },
    });
    expect(r.from).toBe(null);
    expect(r.markdown).toBe("");
  });
});

describe("the Washington Post case, end to end", () => {
  it("shows the ARTICLE when Reader is picked on an unreadable live page", async () => {
    const socket = socketFor();
    const c = await openReader(socket);
    // The ARTICLE is what got laid out. Asserting on the markdown handed to the
    // planner is stricter than a substring of the rendered DOM: it names the
    // source, so an archive read that was fetched and then ignored fails here.
    const plans = socket.emit.mock.calls.filter((x) => x[0] === "import_plan").map((x) => x[1].content);
    expect(plans.some((m) => m.includes("House of Cards"))).toBe(true);
    // It read the SNAPSHOT, not the live url, and said so.
    const reads = socket.emit.mock.calls.filter((x) => x[0] === "page_reader").map((x) => x[1].url);
    expect(reads).toContain(SNAP_URL);
    expect(c.textContent).toMatch(/from the archive/i);
  });

  // THE CONTROL. Without it, "falls back to the archive" is equally satisfied by
  // a reader that ALWAYS reads the archive — which would show a dated capture of
  // every page that reads perfectly well today.
  it("does NOT fetch a snapshot when the live page reads fine", async () => {
    const socket = socketFor({ ok: true, usable: true, framable: true, markdown: "todays text", words: 900 });
    const c = await openReader(socket);
    const plans = socket.emit.mock.calls.filter((x) => x[0] === "import_plan").map((x) => x[1].content);
    expect(plans).toContain("todays text");
    expect(socket.emit.mock.calls.filter((x) => x[0] === "wayback_lookup")).toHaveLength(0);
    expect(c.textContent).not.toMatch(/from the archive/i);
  });

  // User, 2026-09-12: two modes over the same text. READER = one container + one
  // textblock, MAGIC = the importer's full tree. The shape travels with the plan.
  it("Reader asks for the READER shape and Magic for the MAGIC shape, same text", async () => {
    const socket = socketFor({ ok: true, usable: true, framable: true, markdown: "todays text", words: 900 });
    const c = await openReader(socket);
    const shapes = () => socket.emit.mock.calls.filter((x) => x[0] === "import_plan").map((x) => x[1].shape);
    expect(shapes()).toEqual(["reader"]);

    const magic = [...c.querySelectorAll("button")].find((b) => b.textContent === "Magic");
    await act(async () => { fireEvent.click(magic); });
    expect(shapes()).toEqual(["reader", "magic"]);
    const contents = socket.emit.mock.calls.filter((x) => x[0] === "import_plan").map((x) => x[1].content);
    expect(new Set(contents)).toEqual(new Set(["todays text"]));

    // Flipping back is served from the cache — no third plan.
    const reader = [...c.querySelectorAll("button")].find((b) => b.textContent === "Reader");
    await act(async () => { fireEvent.click(reader); });
    expect(shapes()).toEqual(["reader", "magic"]);
  });

  it("Magic falls back to the archive exactly as Reader does", async () => {
    const socket = socketFor();
    let c;
    await act(async () => {
      c = render(<BookmarkView occurrence={occurrence} module={{ kind: "bookmark" }} socket={socket} isActivePage />).container;
    });
    const magic = [...c.querySelectorAll("button")].find((b) => b.textContent === "Magic");
    await act(async () => { fireEvent.click(magic); });
    const plans = socket.emit.mock.calls.filter((x) => x[0] === "import_plan");
    expect(plans.some((x) => x[1].shape === "magic" && x[1].content.includes("House of Cards"))).toBe(true);
    expect(c.textContent).toMatch(/from the archive/i);
  });

  it("says so honestly when neither has text", async () => {
    const socket = socketFor(LIVE_THIN, { ok: false, reason: "no snapshot in the Wayback Machine" });
    const c = await openReader(socket);
    expect(c.textContent).toMatch(/no readable text/i);
  });
});
