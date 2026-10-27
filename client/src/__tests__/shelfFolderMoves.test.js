// A folder made on a shelf shows there (even empty), a book let go on no book is filed where the shelf stands, and a
// folder book moves the folder — never into itself (user, 2026-10-27: "create a new folder, put a note or two in
// there, and then move the folder to a diff place in the tree").
import { describe, it, expect } from "vitest";
import { folderShelfView } from "../vr/shelfItems.js";
import { planFolderMove, planShelfReorder, nativeOfficeState } from "../vr/officeState.js";

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

describe("up a level (let go on the shelf's ⬆)", () => {
  it("a book goes to the folder above where the shelf stands", () => {
    const occ = { ...occurrencesById, n2: { id: "n2", moduleId: "m", parentId: "a1", sortOrder: 0 } };
    expect(planShelfReorder({ shelf, at: "a1", id: "n2", targetId: "", edge: "up" }, { ...ctx, occurrencesById: occ }))
      .toEqual([{ id: "n2", folder: "a", sortOrder: expect.any(Number) }]);
  });
  it("a folder goes to the folder above", () => {
    expect(planFolderMove({ shelf, at: "a", id: "folder:a1", targetId: "", edge: "up" }, ctx).parentId).toBe("root");
  });
  it("nothing goes above the shelf's own folder", () => {
    expect(planShelfReorder({ shelf, at: null, id: "n", targetId: "", edge: "up" }, ctx)).toEqual([]);
    expect(planFolderMove({ shelf, at: null, id: "folder:a", targetId: "", edge: "up" }, ctx)).toBeNull();
  });
});

describe("one shelf's state", () => {
  const grid = { id: "g", meta: { vrOffice: { shelves: [
    { id: "s", title: "Docs", asset: "book", folderId: "root" },
    { id: "t", title: "Other", asset: "book", folderId: "a" },
  ], screens: [] } } };
  it("answers just the shelves asked for", () => {
    const part = nativeOfficeState({ grid, ...ctx }, null, ["s"]);
    expect(part.partial).toBe(true);
    expect(part.shelves.map((x) => x.id)).toEqual(["s"]);
    expect(part.screens).toBeUndefined();
    expect(nativeOfficeState({ grid, ...ctx }).shelves.map((x) => x.id)).toEqual(["s", "t"]);
  });
});
