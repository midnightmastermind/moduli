// OPENING A BOOKMARK — the surface, not the helper.
//
// User, 2026-09-10: *"theres currently no way to open up bookmarks"*, then
// *"shouldnt it open inside the spread"* / *"have that happen if i tap the main
// cover photo"*.
//
// `openBookmark.test.js` covers the DECISION (which panel, does it refuse
// cleanly) and passed the whole time the feature was unreachable. What was
// missing is that the SPREAD — the app's "show me this artifact big" surface,
// and the one a tap on the cover already opens — had no idea what a bookmark
// is. Its renderer branches on image / video / audio / pdf and nothing else, so
// a bookmark tile drew a thumbnail of itself: `filesOf` reports the bookmark as
// its own file (its `fileRef` is a truthy URL), so the overlay showed one card,
// itself, with no way through to the page.
//
// READER FIRST is `BookmarkView`'s own default (a server-side fetch rendered as
// our DOM, falling through to the frame when the read is unusable), so mounting
// it here inherits that rather than re-deciding it.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

const STATE = {
  dispatch: vi.fn(), socket: {}, grid: {}, state: { grid: {} },
  getOcc: () => null, getOccMap: () => ({}), foldersById: {},
  modulesById: {}, viewsById: {}, occurrencesById: {}, fieldsById: {},
};
vi.mock("../GridActionsContext.js", () => ({
  useGridActionsSelector: (sel) => sel(STATE),
  useGridActionsSelectorShallow: (sel) => sel(STATE),
}));

// A stand-in, so this asserts the CARD mounted the reader rather than
// re-testing BookmarkView (which has its own suite).
vi.mock("../modules/BookmarkView.jsx", () => ({
  default: (props) => React.createElement("div", { "data-testid": "bookmark-view", "data-occ": props.occurrence?.id }),
}));

const openBookmarkInPanel = vi.fn(() => ({ ok: true, panelId: "p1", via: "here" }));
vi.mock("../helpers/openBookmark", () => ({ openBookmarkInPanel: (...a) => openBookmarkInPanel(...a) }));

const openArtifactSpread = vi.fn();
vi.mock("../ui/ArtifactSpreadHost", () => ({ openArtifactSpread: (...a) => openArtifactSpread(...a) }));

vi.mock("../helpers/targetPanel", () => ({
  collectPanelOccurrences: () => ({ p1: { id: "p1" } }),
  enclosingPanelId: () => "p1",
}));

import ArtifactCard from "../modules/ArtifactCard";
import { InSpreadContext } from "../helpers/spreadDock";

const BOOKMARK = { id: "m-bm", role: "artifact", kind: "bookmark", label: "YouTube", fileRef: "https://youtube.com/watch?v=x" };
const IMAGE = { id: "m-img", role: "artifact", kind: "image", label: "shot.png", fileRef: "/uploads/shot.png" };
const OCC = { id: "occ-1", moduleId: "m-bm", gridId: "g", userId: "u" };

const mount = (module, { inSpread = false, occurrence = OCC } = {}) => {
  const card = <ArtifactCard module={module} label={module.label} occurrence={occurrence} />;
  return render(inSpread
    ? <InSpreadContext.Provider value={true}>{card}</InSpreadContext.Provider>
    : card).container;
};

beforeEach(() => { openBookmarkInPanel.mockClear(); openArtifactSpread.mockClear(); });

describe("a bookmark opens inside the spread", () => {
  it("tapping the cover opens the spread — the gesture that was already there", () => {
    fireEvent.click(mount(BOOKMARK).querySelector(".artifact-card"));
    expect(openArtifactSpread).toHaveBeenCalledTimes(1);
    expect(openArtifactSpread.mock.calls[0][0]).toBe("occ-1");
  });

  it("and INSIDE the spread the bookmark renders the reader, not a thumbnail", () => {
    const el = mount(BOOKMARK, { inSpread: true });
    const view = el.querySelector('[data-testid="bookmark-view"]');
    expect(view, "the spread still shows a card of itself — the dead end").toBeTruthy();
    expect(view.getAttribute("data-occ")).toBe("occ-1");
  });

  // THE CONTROL. Without it, "the spread renders a bookmark" is also satisfied
  // by a spread that renders the reader for EVERY kind.
  it("an IMAGE in the spread is untouched — it still draws its own picture", () => {
    const el = mount(IMAGE, { inSpread: true, occurrence: { ...OCC, moduleId: "m-img" } });
    expect(el.querySelector('[data-testid="bookmark-view"]')).toBeNull();
    expect(el.querySelector(".artifact-thumb")).toBeTruthy();
  });

  // THE OTHER CONTROL. A bookmark OUTSIDE the spread must stay a cover — a board
  // of 1,468 bookmarks cannot mount 1,468 readers.
  it("a bookmark OUTSIDE the spread is still a cover, not a reader", () => {
    expect(mount(BOOKMARK).querySelector('[data-testid="bookmark-view"]')).toBeNull();
  });

  // THE SCRATCH BROWSER, and the reason the branch sits ABOVE the "no file"
  // guard. A bookmark with no url and no cover is not a broken row — it is a
  // browser you just opened and have not typed into. Below the guard it would
  // return the empty card, so the bookmarks with nothing to preview would be
  // exactly the ones that still could not be opened.
  it("opens even with no url and no cover — a scratch browser", () => {
    const bare = { id: "m-new", role: "artifact", kind: "bookmark", label: "New browser" };
    const el = mount(bare, { inSpread: true, occurrence: { ...OCC, moduleId: "m-new" } });
    expect(el.querySelector('[data-testid="bookmark-view"]')).toBeTruthy();
    expect(el.querySelector(".artifact-card--empty")).toBeNull();
  });

  // NOTHING IS TAKEN AWAY: the panel path the sticky "Open in <panel>" setting
  // exists to serve still works.
  it("double-click still sends it to a panel", () => {
    fireEvent.dblClick(mount(BOOKMARK).querySelector(".artifact-card"));
    expect(openBookmarkInPanel).toHaveBeenCalledTimes(1);
  });
});
