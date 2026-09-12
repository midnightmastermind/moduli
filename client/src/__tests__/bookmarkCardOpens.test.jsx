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
// The card routes through `openUrlInPanel` (which delegates a bookmark to
// `openBookmarkInPanel` internally); the gate `canOpenUrlAsPage` stays REAL so
// the button's presence is decided by the shipped rule, not by the mock.
vi.mock("../helpers/openBookmark", async (importOriginal) => ({
  ...(await importOriginal()),
  openBookmarkInPanel: (...a) => openBookmarkInPanel(...a),
  openUrlInPanel: (...a) => openBookmarkInPanel(...a),
}));

const openArtifactSpread = vi.fn();
vi.mock("../ui/ArtifactSpreadHost", () => ({ openArtifactSpread: (...a) => openArtifactSpread(...a) }));

vi.mock("../helpers/targetPanel", () => ({
  collectPanelOccurrences: () => ({ p1: { id: "p1" } }),
  enclosingPanelId: () => "p1",
  panelOccIdForElement: () => null,
}));

import ArtifactCard from "../modules/ArtifactCard";
import { InSpreadContext } from "../helpers/spreadDock";

// CARRIES A COVER, because 1,467 of the live grid's 1,468 bookmarks do — a
// fixture without one is the RARE case wearing the common case's name, and it
// silently exercised the "nothing to click, open it directly" arm instead of
// the thumbnail-then-click path almost every bookmark actually takes.
const BOOKMARK = {
  id: "m-bm", role: "artifact", kind: "bookmark", label: "YouTube",
  fileRef: "https://youtube.com/watch?v=x",
  meta: { cover: "https://img.test/cover.jpg" },
};
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

  // INVERTED 2026-09-10, with the reason kept rather than deleted. This used to
  // assert the spread mounts the reader IMMEDIATELY. User: *"i have to click on
  // the browser again to see the full view of it in the viewer. this is the
  // behavior i want if we click on the thumbnail."* Opening the viewer straight
  // into the page left no thumbnail step at all — and mounted a reader, a server
  // fetch and an archive lookup for every bookmark tile in the spread.
  it("INSIDE the spread a bookmark with a cover is a THUMBNAIL until it is clicked", () => {
    const el = mount(BOOKMARK, { inSpread: true });
    expect(el.querySelector('[data-testid="bookmark-view"]'), "the browser mounted unasked").toBeNull();
    expect(el.querySelector(".artifact-thumb"), "no thumbnail to click").toBeTruthy();
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

  // INVERTED 2026-09-11, the same day it was written, with the reason kept.
  // The viewer mints a URL tile for any row that points somewhere
  // (`spreadBrowser.js`): an address with no cover. This test first pinned that
  // tile SHUT, to spare an iframe nobody clicked. User, on seeing it: *"it
  // should already be opened there shouldnt be a second click for the browser if
  // there is one"*. There is one url tile per viewer, so the iframe is the point.
  it("a url tile (an address, no cover) is ALREADY the browser in the viewer", () => {
    const urlTile = { id: "m-url", role: "artifact", kind: "bookmark", label: "washingtonpost.com", fileRef: "https://washingtonpost.com/a" };
    const el = mount(urlTile, {
      inSpread: true,
      occurrence: { ...OCC, moduleId: "m-url", meta: { url: "https://washingtonpost.com/a" } },
    });
    expect(el.querySelector('[data-testid="bookmark-view"]'), "a second click is still needed").toBeTruthy();
    expect(el.querySelector(".artifact-thumb"), "it drew a thumbnail instead").toBeNull();
  });

  // THE COVER IS A PICTURE. User, 2026-09-11: *"clicking the cover photo in the
  // viewer also shouldnt open the browser (... i click the cover photo to expand
  // it, it opens up the browser instead)"*. The browser has its own tile now;
  // clicking the cover takes the path clicking any picture takes — the lightbox.
  it("clicking a bookmark's COVER in the viewer expands the PICTURE, not the browser", () => {
    const { container } = render(
      <InSpreadContext.Provider value={true}>
        <div className="artifact-spread">
          <ArtifactCard module={BOOKMARK} label={BOOKMARK.label} occurrence={OCC} />
        </div>
      </InSpreadContext.Provider>
    );
    fireEvent.click(container.querySelector(".artifact-card"));
    // The lightbox is portalled to <body>.
    const media = document.body.querySelector(".artifact-card--expanded .artifact-expanded-media");
    expect(media, "the cover did not expand").toBeTruthy();
    expect(media.getAttribute("src")).toBe("https://img.test/cover.jpg");
    expect(document.body.querySelector('[data-testid="bookmark-view"]'), "it opened the browser").toBeNull();
    expect(openArtifactSpread, "it re-opened the viewer on top of itself").not.toHaveBeenCalled();
  });

  // A bookmark with nothing to preview is still a PAGE. It used to fall to the
  // generic unknown-file glyph, which it never is — we know exactly what it is.
  // Measured OUTSIDE the viewer now, where a coverless bookmark is still a
  // thumbnail (on the Bookmarks board: 2 have no cover, ~28% have a dead one).
  it("draws a web glyph, not an unknown-file one", () => {
    const urlTile = { id: "m-url2", role: "artifact", kind: "bookmark", label: "washingtonpost.com", fileRef: "https://washingtonpost.com/a" };
    const el = mount(urlTile, {
      occurrence: { ...OCC, moduleId: "m-url2", meta: { url: "https://washingtonpost.com/a" } },
    });
    expect(el.textContent).toContain("\u{1F310}");
    expect(el.textContent).not.toContain("\u{1F4C4}");
  });

  // ── THE BUTTON ──────────────────────────────────────────────────────────
  //
  // User, 2026-09-10: *"there should be a button on the bottom right for all
  // occurances that have a url field that opens up that browser page"* / *"that
  // button should be opening the browser page in the PANEL we are in, not the
  // viewer. thats the distinction."*
  //
  // The path existed with NO affordance — reachable only by double-clicking,
  // which is undiscoverable and unreachable on a tablet (a double-tap zooms).
  it("has a button that opens it as a page IN A PANEL, not the viewer", () => {
    const el = mount(BOOKMARK);
    const btn = el.querySelector(".artifact-thumb-page-hint");
    expect(btn, "no open-as-page button on a bookmark").toBeTruthy();
    fireEvent.click(btn);
    expect(openBookmarkInPanel).toHaveBeenCalledTimes(1);
    // THE DISTINCTION the user drew: a panel, never the viewer.
    expect(openArtifactSpread).not.toHaveBeenCalled();
  });

  // THE CONTROL. Without it, "a bookmark has the button" is equally satisfied by
  // putting it on every artifact — an image has no page to open.
  it("an IMAGE has no such button", () => {
    const el = mount(IMAGE, { occurrence: { ...OCC, moduleId: "m-img" } });
    expect(el.querySelector(".artifact-thumb-page-hint")).toBeNull();
  });

  // NOTHING IS TAKEN AWAY: the panel path the sticky "Open in <panel>" setting
  // exists to serve still works.
  it("double-click still sends it to a panel", () => {
    fireEvent.dblClick(mount(BOOKMARK).querySelector(".artifact-card"));
    expect(openBookmarkInPanel).toHaveBeenCalledTimes(1);
  });
});
