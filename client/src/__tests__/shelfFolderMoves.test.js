// A folder made on a shelf shows there (even empty), a book let go on no book is filed where the shelf stands, and a
// folder book moves the folder — never into itself (user, 2026-10-27: "create a new folder, put a note or two in
// there, and then move the folder to a diff place in the tree").
import { describe, it, expect } from "vitest";
import { folderShelfView } from "../vr/shelfItems.js";
import { planFolderMove, planShelfReorder } from "../vr/officeState.js";

const foldersById = {
  root: { id: "root", name: "Documents", parentId: "top" },
  a: { id: "a", name: "Alpha", parentId: "root" },
  b: { id: "b", name: "Beta", parentId: "root" },
  a1: { id: "a1", name: "Inner", parentId: "a" },
  empty: { id: "empty", name: "New", parentId: "root" },
};
const modulesById = { m: { id: "m", role: "page", kind: "doc", label: "Note" } };
const occurrencesById = { n: { id: "n", moduleId: "m", parentId: "root", sortOrder: 0 } };
const ctx = { occurrencesById, modulesById, foldersById };
const shelf = { id: "s", folderId: "root", asset: "book" };

describe("folder shelf", () => {
  it("shows an empty subfolder as a book", () => {
    const v = folderShelfView("root", null, ctx);
    expect(v.items.filter((i) => i.folder).map((i) => i.id)).toEqual(["folder:a", "folder:b", "folder:empty"]);
    expect(v.items.find((i) => i.id === "folder:empty").count).toBe(0);
  });
  it("files a book let go on no book where the shelf stands", () => {
    expect(planShelfReorder({ shelf, at: "empty", id: "n", targetId: "", edge: "end" }, ctx))
      .toEqual([{ id: "n", folder: "empty", sortOrder: expect.any(Number) }]);
  });
});

describe("planFolderMove", () => {
  it("moves a folder into another folder book", () => {
    expect(planFolderMove({ shelf, at: null, id: "folder:a", targetId: "folder:b", edge: "into" }, ctx).parentId).toBe("b");
  });
  it("moves a folder carried into another level to where the shelf stands", () => {
    expect(planFolderMove({ shelf, at: "b", id: "folder:a", targetId: "", edge: "end" }, ctx).parentId).toBe("b");
  });
  it("does nothing when it stays where it is", () => {
    expect(planFolderMove({ shelf, at: null, id: "folder:a", targetId: "", edge: "end" }, ctx)).toBeNull();
  });
  it("never moves a folder into itself or a folder inside it", () => {
    expect(planFolderMove({ shelf, at: "a", id: "folder:a", targetId: "", edge: "end" }, ctx)).toBeNull();
    expect(planFolderMove({ shelf, at: "a", id: "folder:a", targetId: "folder:a1", edge: "into" }, ctx)).toBeNull();
  });
});
