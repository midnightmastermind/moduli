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

describe("the frame says it is loading", () => {
  it("shows a spinner while the page has not loaded", () => {
    const el = openWeb();
    expect(el.querySelector("iframe"), "web mode did not render a frame").toBeTruthy();
    expect(el.querySelector('[role="status"]')).toBeTruthy();
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
