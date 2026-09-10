// WAITING ON A PAGE SHOULD LOOK LIKE WAITING.
//
// User, 2026-09-10: *"currently waiting on a browser slows the site to a
// crawl"* … *"it results in a broken page which i figure, but it shouldnt slow
// the entire app down"* … *"put a loading circle in for when the site is loading
// too"*.
//
// The frame is a live third-party page and how long it takes is the browser's
// business, not ours — what WAS ours is that the surface said nothing while it
// happened, so a slow site and a dead app looked identical. This is the part we
// control.
//
// It clears on the frame's OWN `load`, which fires for a refused page too (the
// browser loads its error document), so a site that says no stops spinning
// rather than pretending it is still trying.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

vi.mock("../GridActionsContext.js", () => ({
  useGridActionsSelector: (sel) => sel({ fieldsById: {}, dispatch: vi.fn(), gridId: "g", userId: "u" }),
}));
vi.mock("../helpers/occurrenceUrl", () => ({
  occurrenceUrl: () => ({ url: "https://example.com/article", from: "field" }),
  hasViewableUrl: () => true,
}));
// Force WEB mode: `resolveMode` prefers the reader when the fetch is usable, so
// without this the arm under test never renders.
vi.mock("../helpers/embedUrl", () => ({ embedUrlFor: () => null }));

import BookmarkView from "../modules/BookmarkView.jsx";

const occurrence = { id: "b1", fields: { f: { value: "https://example.com/article" } }, meta: {} };
// A socket whose `page_reader` never answers — the WAITING state, which is the
// whole subject. The ack is simply never called.
const socket = { emit: vi.fn() };

const openWeb = () => {
  const r = render(<BookmarkView occurrence={occurrence} module={{ kind: "bookmark" }} socket={socket} isActivePage />);
  const web = [...r.container.querySelectorAll("button")].find((b) => b.textContent === "Web");
  act(() => { fireEvent.click(web); });
  return r.container;
};

beforeEach(() => { socket.emit.mockClear(); });

describe("the READER fetch says it is loading", () => {
  // THE 20-SECOND WINDOW. `safeFetchUrl` gives a page 20s to answer, and a site
  // that never does (the Washington Post, measured — the recording shows ~20s of
  // an empty overlay) burns all of it before falling through to the frame.
  //
  // `resolveMode` returns "loading" for that whole time, and it rendered a
  // 12px "Reading…" and nothing else — in a full-screen overlay, which is why
  // it read as the app having died rather than as a page being fetched.
  it("shows the loading icon while the page is being read", () => {
    const { container } = render(
      <BookmarkView occurrence={occurrence} module={{ kind: "bookmark" }} socket={socket} isActivePage />,
    );
    // The ack is never called, which IS the state under test.
    expect(container.querySelector('[role="status"]'), "no loading icon while reading").toBeTruthy();
  });
});

describe("the frame says it is loading", () => {
  it("shows a spinner while the page has not loaded", () => {
    const el = openWeb();
    expect(el.querySelector("iframe"), "web mode did not render a frame").toBeTruthy();
    expect(el.querySelector('[role="status"]')).toBeTruthy();
  });

  // THE REGRESSION THIS BROKE ONCE. The content wrapper this sits inside is a
  // flex CHILD but a plain BLOCK itself, so `flex: 1` on a box in here is inert
  // and collapses to auto — taking the frame's own `height: 100%` with it. The
  // first version of the spinner wrapper did exactly that and the page stopped
  // filling the overlay. The reader branch resolves the same way for the same
  // reason, so this is the house rule here rather than a special case.
  it("gives the frame a box with real height, not an inert flex child", () => {
    const el = openWeb();
    const box = el.querySelector("iframe").parentElement;
    expect(box.style.height).toBe("100%");
    expect(box.style.flex, "flex is inert inside this block parent").toBe("");
  });

  it("clears it when the frame reports load — including a refused page", () => {
    const el = openWeb();
    act(() => { fireEvent.load(el.querySelector("iframe")); });
    expect(el.querySelector('[role="status"]')).toBeNull();
    // THE CONTROL: the frame is still there. A spinner that cleared by
    // unmounting the page would also pass the line above.
    expect(el.querySelector("iframe")).toBeTruthy();
  });
});


// THE CALL SITE. `bookmarkView.test.jsx` covers `resolveMode`, which is pure —
// and a pure rule that says "show the snapshot" does nothing if nobody ever ASKS
// for one. The archive lookup was deliberately lazy (a request to a third party
// per bookmark opened is not free), so the fall-through only works if the refusal
// itself is what triggers it.
describe("a refused page goes looking for a snapshot on its own", () => {
  const refusingSocket = () => ({
    emit: vi.fn((event, payload, ack) => {
      if (event === "page_reader" && typeof ack === "function") {
        // The verdict that matters: the site answered, and it refuses framing.
        ack({ ok: true, usable: false, framable: false, frameBlockedBy: "x-frame-options: sameorigin" });
      }
    }),
  });

  it("asks the archive WITHOUT the user picking it", () => {
    const sk = refusingSocket();
    act(() => {
      render(<BookmarkView occurrence={occurrence} module={{ kind: "bookmark" }} socket={sk} isActivePage />);
    });
    const asked = sk.emit.mock.calls.filter((c) => c[0] === "wayback_lookup");
    expect(asked.length, "the refusal did not trigger a snapshot lookup").toBe(1);
  });

  // AND IT SHOWS WHAT IT FOUND. Without this the component could look the
  // snapshot up and never pass it on — measured: hardcoding `archived: false`
  // at the call site left all 37 other tests green, because they exercise the
  // pure rule and never reach the state where a snapshot exists.
  it("renders the snapshot once the lookup finds one", () => {
    const sk = {
      emit: vi.fn((event, payload, ack) => {
        if (typeof ack !== "function") return;
        if (event === "page_reader") ack({ ok: true, usable: false, framable: false, frameBlockedBy: "x-frame-options: sameorigin" });
        if (event === "wayback_lookup") ack({ ok: true, url: "https://web.archive.org/web/2021/https://example.com/article", capturedAt: "2021-12-04" });
      }),
    };
    let el;
    act(() => {
      el = render(<BookmarkView occurrence={occurrence} module={{ kind: "bookmark" }} socket={sk} isActivePage />).container;
    });
    const frame = el.querySelector("iframe");
    expect(frame, "no snapshot rendered").toBeTruthy();
    expect(frame.getAttribute("src")).toContain("web.archive.org");
    expect(el.textContent).not.toContain("will not open inside a panel");
  });

  // THE CONTROL, and it is the reason the lookup was lazy in the first place: a
  // page that frames FINE must not send archive.org a request just for being
  // opened. Without this, "asks the archive" is also satisfied by asking always.
  it("does NOT ask when the page frames fine", () => {
    const sk = {
      emit: vi.fn((event, payload, ack) => {
        if (event === "page_reader" && typeof ack === "function") {
          ack({ ok: true, usable: false, framable: true });
        }
      }),
    };
    act(() => {
      render(<BookmarkView occurrence={occurrence} module={{ kind: "bookmark" }} socket={sk} isActivePage />);
    });
    expect(sk.emit.mock.calls.filter((c) => c[0] === "wayback_lookup").length).toBe(0);
  });
});
