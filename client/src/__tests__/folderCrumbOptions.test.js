import { describe, it, expect } from "vitest";
import { buildFolderCrumbOptions } from "../helpers/containerCrumbs";

const F = (id, name, parentId = null, extra = {}) => ({ id, name, parentId, ...extra });
const folders = Object.fromEntries([
  F("root", "Root"),
  F("codex", "Codex", "root"),
  F("notes", "Notes", "codex"),
  F("boards", "Boards", "root"),
  F("cat", "Fitness", null, { folderType: "category" }),   // a field category, not in the tree
  F("orphan", "Lost", "gone"),
].map(f => [f.id, f]));

describe("buildFolderCrumbOptions", () => {
  it("lists every folder under the root with its full chain, sorted", () => {
    expect(buildFolderCrumbOptions(folders, "root")).toEqual([
      { id: "root", label: "Root" },
      { id: "boards", label: "Root › Boards" },
      { id: "codex", label: "Root › Codex" },
      { id: "notes", label: "Root › Codex › Notes" },
    ]);
  });

  it("leaves out folders that are not in this tree (categories, orphans)", () => {
    const ids = buildFolderCrumbOptions(folders, "root").map(o => o.id);
    expect(ids).not.toContain("cat");
    expect(ids).not.toContain("orphan");
  });

  it("returns nothing without a root to walk to", () => {
    expect(buildFolderCrumbOptions(folders, null)).toEqual([]);
    expect(buildFolderCrumbOptions(folders, "nope")).toEqual([]);
  });

  it("terminates on a parent cycle", () => {
    const loop = { a: F("a", "A", "b"), b: F("b", "B", "a"), root: F("root", "Root") };
    expect(buildFolderCrumbOptions(loop, "root")).toEqual([{ id: "root", label: "Root" }]);
  });
});
