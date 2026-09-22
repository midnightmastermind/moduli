// Renaming a folder renames the page that folder opens — unless the user
// titled that page themselves. Found rebuilding poms grid through the UI
// (2026-09-22): the `Library` folder's page still read `New Folder`, and that
// label is what the panel header and the folder card show.
import { describe, it, expect } from "vitest";
import { planFolderPageRename } from "../helpers/folderRename";

const folder = { id: "f1", name: "New Folder" };
const page = { id: "o1", moduleId: "m-page" };
const mods = (label) => ({ "m-page": { id: "m-page", kind: "folder", role: "page", label } });

describe("planFolderPageRename", () => {
  it("renames the folder page that still wears the old name", () => {
    expect(planFolderPageRename({ folder, newName: "Library", childOccurrences: [page], modulesById: mods("New Folder") }))
      .toEqual({ moduleId: "m-page", label: "Library" });
  });

  it("leaves a page the user titled themselves", () => {
    expect(planFolderPageRename({ folder, newName: "Library", childOccurrences: [page], modulesById: mods("My Shelf") })).toBeNull();
  });

  it("does nothing when the folder has no page yet", () => {
    expect(planFolderPageRename({ folder, newName: "Library", childOccurrences: [], modulesById: {} })).toBeNull();
    // A child that is NOT the folder's page is not a candidate either.
    const other = { id: "o2", moduleId: "m-board" };
    expect(planFolderPageRename({ folder, newName: "Library", childOccurrences: [other], modulesById: { "m-board": { id: "m-board", kind: "board", role: "page", label: "New Folder" } } })).toBeNull();
  });

  it("does nothing for an empty or unchanged name", () => {
    expect(planFolderPageRename({ folder, newName: "   ", childOccurrences: [page], modulesById: mods("New Folder") })).toBeNull();
    expect(planFolderPageRename({ folder, newName: "New Folder", childOccurrences: [page], modulesById: mods("New Folder") })).toBeNull();
  });
});
