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
const modules = {
  "m-folder": { id: "m-folder", role: "page", kind: "folder" },
  "m-board": { id: "m-board", role: "page", kind: "board" },
  "m-doc": { id: "m-doc", role: "page", kind: "doc" },
};
const folderPage = (id, parentId) => ({ id, moduleId: "m-folder", parentId });
const boardPage = (id, parentId) => ({ id, moduleId: "m-board", parentId });
const docPage = (id, parentId) => ({ id, moduleId: "m-doc", parentId });
const run = (pinned) => flattenPinnedPages({ pinned, modulesById: modules });

describe("flattenPinnedPages", () => {
  it("returns every pinned page as one flat row, in pin order", () => {
    // Pin order, NOT grouped by parent folder — p1 and p3 sit in different
    // folders and still come out adjacent to p2.
    expect(run([docPage("p1", "health"), docPage("p2", null), docPage("p3", "imports")]))
      .toEqual(["p1", "p2", "p3"]);
  });

  it("DROPS a folder page that duplicates a real page of the same name", () => {
    // The live shape: "Examples" was a board page AND a folder page in the same
    // folder, so the flat list showed the same word twice (user: "i should only
    // have 1 tasks and 1 example correct"). Folder pages are minted ON VIEW,
    // not pinned deliberately, which is why they accumulate.
    expect(run([boardPage("examples-board", "lib"), folderPage("examples-folder", "lib")]))
      .toEqual(["examples-board"]);
  });

  it("drops a pinned folder page even when nothing else shares its name", () => {
    // The rule is about what the row IS, not about collision — the manifest
    // below already lists every folder.
    expect(run([folderPage("f1", ROOT)])).toEqual([]);
  });

  it("keeps every NON-folder page, which is the control", () => {
    // Without this the previous two would pass for "return nothing".
    expect(run([boardPage("b1", ROOT), docPage("d1", null), folderPage("f1", ROOT)]))
      .toEqual(["b1", "d1"]);
  });

  it("empty in, empty out — the section hides itself rather than drawing a header", () => {
    expect(run([])).toEqual([]);
    expect(flattenPinnedPages({ modulesById: modules })).toEqual([]);
    expect(flattenPinnedPages({ pinned: null, modulesById: modules })).toEqual([]);
  });
});
