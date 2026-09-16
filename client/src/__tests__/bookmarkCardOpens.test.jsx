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

// ISOLATION IS SIGNALLED BY `socket`, NOT BY WHETHER AN ID RESOLVES.
//
// `PagePreviewBody` mounts its own provider with `dispatch: noop` / `socket:
// null` over the PLANNED reader rows — so `getOcc` there RESOLVES the planned
// row and cannot distinguish the reader from the app. A guard keyed on getOcc
// shipped to prod and stayed dead for exactly that reason. `socket` is the
// condition that actually differs, and it is the same nulling that makes the
// reader unable to write.
let SOCKET = {};

const STATE = {
  dispatch: vi.fn(), grid: {}, state: { grid: {} },
  get socket() { return SOCKET; },
  // Resolves in BOTH contexts, mirroring the preview provider — so a test that
  // passes here cannot be passing because the id happened not to resolve.
  getOcc: (id) => ({ id }), getOccMap: () => ({}), foldersById: {},
  modulesById: {}, viewsById: {}, occurrencesById: {}, fieldsById: {},
  // The app's getState() returns the raw reducer state, which carries `views`
  // as an ARRAY and no `viewsById`. Reading views off it is what left the open
  // unable to activate the page (2026-09-12); the views come from getViewMap.
  getState: () => ({ grid: {}, views: [{ id: "v-panel" }] }),
  getViewMap: () => ({ "v-panel": { id: "v-panel" } }),
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

beforeEach(() => { openBookmarkInPanel.mockClear(); openArtifactSpread.mockClear(); SOCKET = {}; });

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

  // THE EXPAND BUTTON IS A SECOND WAY IN, AND IT WENT SOMEWHERE ELSE.
  // User, 2026-09-16: *"also make sure that the expand for the images, opens it
  // in the viewer"*. Measured on prod first — clicking it on an image in a
  // Magic-rendered article produced `.artifact-fullscreen` 1 / `.artifact-spread`
  // 0, i.e. the in-place lightbox. The card's own click already opened the
  // viewer, so this button was the one affordance on a picture that did not.
  it("the expand button on an image opens the VIEWER, not the in-place lightbox", () => {
    // A real board card: a live socket, i.e. the app's own store is behind us.
    const el = mount(IMAGE, { occurrence: { ...OCC, moduleId: "m-img" } });
    const btn = el.querySelector(".artifact-thumb-expand-hint");
    expect(btn, "no expand affordance to click").toBeTruthy();
    fireEvent.click(btn);
    expect(openArtifactSpread).toHaveBeenCalledTimes(1);
    expect(openArtifactSpread.mock.calls[0][0]).toBe("occ-1");
    // The lightbox PORTALS to document.body, so a query scoped to the card
    // would read null whether or not it opened — this has to ask the document.
    expect(document.querySelector(".artifact-fullscreen"), "it opened the lightbox instead").toBeNull();
  });

  // THE OTHER HALF, AND IT IS THE ONE THAT SHIPPED BROKEN. In Magic/Reader the
  // row is a PLANNED occurrence the real store does not hold, so the spread host
  // can never resolve it. The first version of this feature reached for the
  // viewer anyway and prod measured `.artifact-spread` 0 / `.artifact-fullscreen`
  // 0 — the button did NOTHING, worse than the lightbox it replaced. Here the
  // lightbox is not a consolation prize; it is the only thing that can open.
  it("on a PLANNED (reader) occurrence it falls back to the lightbox — never a dead button", () => {
    // The reader's provider: socket null. NOTE `getOcc` still RESOLVES this id
    // — that is the whole point. The guard that keyed on getOcc passed a test
    // like this only because the fixture withheld the row; prod did not.
    SOCKET = null;
    const el = mount(IMAGE, { occurrence: { ...OCC, moduleId: "m-img" } });
    fireEvent.click(el.querySelector(".artifact-thumb-expand-hint"));
    expect(openArtifactSpread, "it opened a viewer that cannot resolve this row").not.toHaveBeenCalled();
    expect(document.querySelector(".artifact-fullscreen"), "nothing opened at all").toBeTruthy();
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
  // User, 2026-09-15: *"the button to open the url as a browser page should be
  // on the occurance and not the cover image of the instance"*. The button moved
  // to the row's handle group (`urlButtonPlacement` → "header"); the card itself
  // carries none.
  it("puts NO open-as-page button on the card (it would sit on the cover image)", () => {
    const el = mount(BOOKMARK);
    expect(el.querySelector(".artifact-thumb-page-hint")).toBeNull();
    expect(el.querySelector('[aria-label="Open link"]')).toBeNull();
  });

  it("double-click opens it IN A PANEL, not the viewer", () => {
    fireEvent.dblClick(mount(BOOKMARK).querySelector(".artifact-card"));
    expect(openBookmarkInPanel).toHaveBeenCalledTimes(1);
    // THE DISTINCTION the user drew: a panel, never the viewer.
    expect(openArtifactSpread).not.toHaveBeenCalled();
  });

  // Without the panel's VIEW the open pins the page and never makes it active,
  // so the panel stays where it was — the button "does nothing".
  it("hands the open the panel views, not an empty map", () => {
    fireEvent.dblClick(mount(BOOKMARK).querySelector(".artifact-card"));
    expect(openBookmarkInPanel.mock.calls[0][0].viewsById).toEqual({ "v-panel": { id: "v-panel" } });
  });

  // THE CONTROL. Without it, "a bookmark opens in a panel" is equally satisfied
  // by sending every artifact there — an image has no page to open.
  it("an IMAGE is not sent to a panel on double-click", () => {
    fireEvent.dblClick(mount(IMAGE, { occurrence: { ...OCC, moduleId: "m-img" } }).querySelector(".artifact-card"));
    expect(openBookmarkInPanel).not.toHaveBeenCalled();
  });

  // NOTHING IS TAKEN AWAY: the panel path the sticky "Open in <panel>" setting
  // exists to serve still works.
  it("double-click still sends it to a panel", () => {
    fireEvent.dblClick(mount(BOOKMARK).querySelector(".artifact-card"));
    expect(openBookmarkInPanel).toHaveBeenCalledTimes(1);
  });
});
