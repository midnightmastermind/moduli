// The Pinned section is a FLAT list of the panel's pinned pages.
//
// It used to build a tree: folder subtrees for pinned folder pages, folder
// headers grouping the rest. That was removed (user, 2026-08-26: "remove the
// folders from the pinned tree. just show a flat list of the pinned files") —
// the whole manifest, folders and all, renders directly underneath Pinned, so
// the grouping was a second, shallower copy of the thing below it.
//
// The ORIGINAL bug this file was written for still cannot come back, and that
// is the case worth keeping: a panel fronted by the ROOT folder page made
// Pinned expand the entire manifest a second time. With no subtrees there is
// nothing to expand — asserted below rather than assumed.
import { describe, it, expect } from "vitest";
import { flattenPinnedPages } from "../modules/ManifestTree.jsx";

const ROOT = "0QU2baW0EjIb";
const folderPage = (id, parentId) => ({ id, moduleId: "m-folder", parentId });
const docPage = (id, parentId) => ({ id, moduleId: "m-doc", parentId });

describe("flattenPinnedPages", () => {
  it("returns every pinned page as one flat row, in pin order", () => {
    const out = flattenPinnedPages({
      pinned: [docPage("p1", "health"), docPage("p2", null), docPage("p3", "imports")],
    });
    // Pin order, NOT grouped by parent folder — p1 and p3 sit in different
    // folders and still come out adjacent to p2.
    expect(out).toEqual(["p1", "p2", "p3"]);
  });

  it("a pinned FOLDER page is one row, not a subtree", () => {
    // The regression that named this file: this used to expand the whole
    // manifest underneath Pinned.
    const out = flattenPinnedPages({ pinned: [folderPage("f1", ROOT), docPage("p1", "health")] });
    expect(out).toEqual(["f1", "p1"]);
    // A row, not a tree — the output is ids only, so there is no subtree for
    // the renderer to walk. That is the structural guarantee.
    expect(out.every((x) => typeof x === "string")).toBe(true);
  });

  it("keeps a pinned folder page rather than dropping it", () => {
    // Dropping it would make a pinned page unreachable from the sidebar, which
    // is a bigger surprise than a row you can ignore.
    expect(flattenPinnedPages({ pinned: [folderPage("f1", ROOT)] })).toEqual(["f1"]);
  });

  it("empty in, empty out — the section hides itself rather than drawing a header", () => {
    expect(flattenPinnedPages({ pinned: [] })).toEqual([]);
    expect(flattenPinnedPages({})).toEqual([]);
    expect(flattenPinnedPages({ pinned: null })).toEqual([]);
  });
});
