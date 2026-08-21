// The Pinned section must never re-draw the manifest that sits below it.
//
// Since the two sidebars merged (2026-08-21) the full manifest renders directly
// under Pinned. A panel holding the ROOT folder page — which is exactly what
// clicking `Root` in that very tree pins — made Pinned expand the whole manifest
// a second time (user: "its also pinning all of root right now whioch shouldnt
// happen"). Measured on poms grid before the fix: Panel C pins `Root`, whose
// folder IS `manifest.rootFolderId`.
//
// The discriminating case is the NON-root folder page beside it: Boards/Imports
// must still render their subtree, so a blanket "no folder nodes in Pinned"
// would pass the first test and break the feature this branch exists for.
import { describe, it, expect } from "vitest";
import { partitionPinnedPages } from "../modules/ManifestTree.jsx";

const ROOT = "0QU2baW0EjIb";
const folders = {
  [ROOT]: { id: ROOT, name: "Root" },
  imports: { id: "imports", name: "Imports" },
  health: { id: "health", name: "Health" },
};
const modules = {
  "m-folder": { id: "m-folder", role: "page", kind: "folder" },
  "m-doc": { id: "m-doc", role: "page", kind: "doc" },
};
const folderPage = (id, parentId) => ({ id, moduleId: "m-folder", parentId });
const docPage = (id, parentId) => ({ id, moduleId: "m-doc", parentId });

const run = (pinned) => partitionPinnedPages({
  pinned, modulesById: modules, foldersById: folders, rootFolderId: ROOT,
});

describe("partitionPinnedPages", () => {
  it("drops a pinned ROOT folder page — the manifest below already draws it", () => {
    const out = run([folderPage("p1", ROOT)]);
    expect(out.folderNodes).toEqual([]);
    expect(out.folderGroups).toEqual([]);
    expect(out.rootPages).toEqual([]);
  });

  it("KEEPS a pinned non-root folder page as a full subtree", () => {
    const out = run([folderPage("p2", "imports")]);
    expect(out.folderNodes.map(f => f.id)).toEqual(["imports"]);
  });

  it("drops only the root one when both are pinned", () => {
    const out = run([folderPage("p1", ROOT), folderPage("p2", "imports")]);
    expect(out.folderNodes.map(f => f.id)).toEqual(["imports"]);
  });

  it("groups ordinary pages under their parent folder", () => {
    const out = run([docPage("d1", "health"), docPage("d2", "health")]);
    expect(out.folderGroups).toHaveLength(1);
    expect(out.folderGroups[0].pages).toEqual(["d1", "d2"]);
    expect(out.rootPages).toEqual([]);
  });

  it("lists a folderless page flat", () => {
    const out = run([docPage("d3", null)]);
    expect(out.rootPages).toEqual(["d3"]);
  });

  it("never lists a folder's pages twice when the folder is also a full node", () => {
    const out = run([folderPage("p2", "imports"), docPage("d4", "imports")]);
    expect(out.folderNodes.map(f => f.id)).toEqual(["imports"]);
    expect(out.folderGroups).toEqual([]);
  });

  it("a root folder page whose parent folder is missing is still not a node", () => {
    const out = run([folderPage("p5", "gone")]);
    expect(out.folderNodes).toEqual([]);
  });
});
