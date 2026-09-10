// THE SECOND ROUND TRIP IS GONE FOR THE COMMON CASE.
//
// The client used to learn "this page cannot be shown" from `page_reader` and
// then spend a SECOND, strictly serial round trip on `wayback_lookup`. Measured
// 2026-09-10 over 60 of the user's own bookmarks that is the COMMON path — 35%
// refuse framing outright, 18% cannot be fetched at all — so `page_reader` now
// answers with the snapshot already found.
//
// What these pin is that the client BELIEVES it: it must not ask again for
// something it was just handed, and it must still ask when it was not.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";

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

/** A socket that answers `page_reader` with `reply` and records every emit. */
const socketAnswering = (reply) => {
  const emit = vi.fn((ev, _payload, ack) => {
    if (ev === "page_reader" && typeof ack === "function") ack(reply);
  });
  return { emit };
};
const mount = (socket) => act(() => {
  render(<BookmarkView occurrence={occurrence} module={{ kind: "bookmark" }} socket={socket} isActivePage />);
});
const lookups = (socket) => socket.emit.mock.calls.filter((c) => c[0] === "wayback_lookup");

beforeEach(() => { vi.clearAllMocks(); });

describe("a snapshot that arrived with the read is not asked for again", () => {
  it("makes NO second round trip when page_reader carried one", async () => {
    const socket = socketAnswering({
      ok: true, usable: false, framable: false, frameBlockedBy: "x-frame-options: sameorigin",
      markdown: "", words: 91, archive: SNAP,
    });
    mount(socket);
    expect(lookups(socket)).toHaveLength(0);
  });

  it("renders the snapshot it was handed", async () => {
    const socket = socketAnswering({
      ok: true, usable: false, framable: false, markdown: "", words: 91, archive: SNAP,
    });
    let container;
    await act(async () => {
      container = render(
        <BookmarkView occurrence={occurrence} module={{ kind: "bookmark" }} socket={socket} isActivePage />,
      ).container;
    });
    const frame = container.querySelector("iframe");
    expect(frame, "no frame rendered for the snapshot").toBeTruthy();
    expect(frame.getAttribute("src")).toBe(SNAP.url);
  });

  // THE CONTROL. Without it, "makes no second round trip" is equally satisfied
  // by a client that never looks a snapshot up at all — which is the whole
  // Archive mode gone.
  it("STILL asks when the read carried none", async () => {
    const socket = socketAnswering({
      ok: true, usable: false, framable: false, markdown: "", words: 91, archive: null,
    });
    mount(socket);
    expect(lookups(socket)).toHaveLength(1);
  });

  it("and asks when the fetch failed with no snapshot attached", async () => {
    const socket = socketAnswering({ ok: false, error: "timed out after 6000ms", usable: false });
    mount(socket);
    expect(lookups(socket)).toHaveLength(1);
  });
});
