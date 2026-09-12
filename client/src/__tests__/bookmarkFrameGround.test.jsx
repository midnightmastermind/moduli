// A FRAME NEEDS A GROUND OF ITS OWN.
//
// User, 2026-09-10: *"the archive has a transparent background and i cant see
// the page"*. An `<iframe>` with no background is TRANSPARENT, so anything the
// framed document does not paint shows whatever sits behind the frame — and this
// surface opens over the spread's dark backdrop. A page whose body sets no colour
// of its own then renders its own dark text on that dark ground, which reads as a
// page that failed to load.
//
// Wayback's rewritten pages are the common case: the archive strips or rewrites
// enough of the original CSS that the body frequently paints nothing. The LIVE
// frame has exactly the same hole — it just bites less often, because most live
// sites paint their own body.
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

import BookmarkView from "../modules/BookmarkView.jsx";

const occurrence = { id: "b1", fields: {}, meta: {} };
const SNAP = { ok: true, url: "https://web.archive.org/web/2023/x", capturedAt: "2023-12-05T05:54:28.000Z" };

/** Answers page_reader with `reply`, and wayback_lookup with a snapshot. */
const socketWith = (reply) => ({
  emit: vi.fn((ev, _p, ack) => {
    if (typeof ack !== "function") return;
    if (ev === "page_reader") ack(reply);
    if (ev === "wayback_lookup") ack(SNAP);
  }),
});

const mount = async (socket) => {
  let c;
  await act(async () => {
    c = render(<BookmarkView occurrence={occurrence} module={{ kind: "bookmark" }} socket={socket} isActivePage />).container;
  });
  return c;
};

beforeEach(() => { vi.clearAllMocks(); });

describe("a framed page is never transparent", () => {
  it("the ARCHIVE frame paints a ground — the reported bug", async () => {
    const c = await mount(socketWith({ ok: true, usable: false, framable: false, markdown: "", words: 91 }));
    const frame = c.querySelector("iframe");
    expect(frame, "no archive frame rendered").toBeTruthy();
    expect(frame.getAttribute("src")).toBe(SNAP.url);
    // Not merely "some background" — a page viewport is white. A themed tint
    // would misrepresent every site that DOES paint its own body.
    expect(frame.style.background).toMatch(/#fff|rgb\(255,\s*255,\s*255\)|white/i);
  });

  it("and so does the LIVE frame — the same hole, it just bites less often", async () => {
    const socket = socketWith({ ok: true, usable: true, framable: true, markdown: "text", words: 900 });
    let c;
    await act(async () => {
      c = render(<BookmarkView occurrence={occurrence} module={{ kind: "bookmark" }} socket={socket} isActivePage />).container;
    });
    const web = [...c.querySelectorAll("button")].find((b) => b.textContent === "Web");
    await act(async () => { fireEvent.click(web); });
    const frame = c.querySelector("iframe");
    expect(frame, "no live frame rendered").toBeTruthy();
    expect(frame.style.background).toMatch(/#fff|rgb\(255,\s*255,\s*255\)|white/i);
  });

  // AND THE READER PANE, which is OUR DOM rather than a frame — found by LOOKING
  // at prod (2026-09-10), where the article text rendered straight over the Tasks
  // panel and the Trackers behind it. The spread's overlay is deliberately
  // transparent so the grid reads through it, which is right for a picture and
  // unreadable for a page of prose.
  it("the READER pane has a ground too — prose over a grid is unreadable", async () => {
    const socket = socketWith({ ok: true, usable: true, markdown: "the article text", words: 900, framable: true });
    let c;
    await act(async () => {
      c = render(<BookmarkView occurrence={occurrence} module={{ kind: "bookmark" }} socket={socket} isActivePage />).container;
    });
    // FOUND BY ITS OWN HOOK, not by the text inside it. An earlier version
    // matched `textContent === "the article text"`, which only worked while the
    // reader PRINTED ITS MARKDOWN SOURCE; since 2026-09-12 it renders the
    // planned occurrence tree instead, so that selector found nothing and the
    // test failed while the ground it guards was perfectly intact. What this
    // test is ABOUT is the background, so it should not also depend on how the
    // contents happen to be rendered.
    const reader = c.querySelector("[data-reader-pane]");
    expect(reader, "no reader pane rendered").toBeTruthy();
    expect(reader.style.background, "the reader is transparent over the grid").toBeTruthy();
  });

  // THE CONTROL. Without it "sets a background" is also satisfied by a frame
  // that lost the sizing it needs — which is the height bug one level over,
  // reintroduced by the same edit.
  it("without losing the fill it needs", async () => {
    const c = await mount(socketWith({ ok: true, usable: false, framable: false, markdown: "", words: 91 }));
    const frame = c.querySelector("iframe");
    expect(frame.style.width).toBe("100%");
    expect(frame.style.height).toBe("100%");
  });
});
