// server/__tests__/filesFolder.test.js
//
// Files are identified by LOCATION — the children of the one protected "Files"
// folder under the user manifest — exactly as templates are. Task 4 of
// docs/superpowers/plans/2026-08-06-intake-links-and-artifacts.md.
//
// The case worth the most here is the LAST one: `resolveFilesFolderId` returns
// null rather than guessing. A file written to the wrong folder is data loss
// that presents as a missing file.
import { describe, it, expect } from "vitest";
import {
  findFilesFolder, findFilesSubfolder, resolveFilesFolderId,
  filesSubfolderForKind, placementSemanticForKind, FILES_SUBFOLDER_NAMES,
} from "../utils/filesFolder.js";

const G = "g1";
const U = "u1";

const ucWith = (folders) => ({ foldersById: Object.fromEntries(folders.map(f => [f.id, f])) });

const filesFolder = { id: "files-f", gridId: G, userId: U, name: "Files", meta: { protected: true } };
const images = { id: "img-f", gridId: G, userId: U, name: "Images", parentId: "files-f" };
const docs = { id: "doc-f", gridId: G, userId: U, name: "Documents", parentId: "files-f" };
const full = ucWith([filesFolder, images, docs]);

describe("findFilesFolder", () => {
  it("finds the protected Files folder", () => {
    expect(findFilesFolder(full, { gridId: G, userId: U })?.id).toBe("files-f");
  });

  it("ignores a USER folder that happens to be called Files", () => {
    // Protection is carried by meta.protected, never by the name — the user may
    // have their own "Files" folder and it is theirs.
    const uc = ucWith([{ id: "mine", gridId: G, userId: U, name: "Files" }]);
    expect(findFilesFolder(uc, { gridId: G, userId: U })).toBeNull();
  });

  it("is scoped to the grid AND the user", () => {
    expect(findFilesFolder(full, { gridId: "other", userId: U })).toBeNull();
    expect(findFilesFolder(full, { gridId: G, userId: "other" })).toBeNull();
  });

  it("returns null on a grid that has not run the migration", () => {
    expect(findFilesFolder(ucWith([]), { gridId: G, userId: U })).toBeNull();
  });
});

describe("subfolders derive from the upload path's own kinds", () => {
  it("maps every mimeToKind output, and lumps code + markdown as Documents", () => {
    expect(filesSubfolderForKind("image")).toBe("Images");
    expect(filesSubfolderForKind("video")).toBe("Video");
    expect(filesSubfolderForKind("audio")).toBe("Audio");
    expect(filesSubfolderForKind("pdf")).toBe("Documents");
    expect(filesSubfolderForKind("code")).toBe("Documents");
    expect(filesSubfolderForKind("markdown")).toBe("Documents");
  });

  it("sends an unknown kind to Documents rather than inventing a folder", () => {
    expect(filesSubfolderForKind("something-new")).toBe("Documents");
    expect(FILES_SUBFOLDER_NAMES).toContain("Documents");
  });

  it("finds a subfolder only when it is a DIRECT child of Files", () => {
    expect(findFilesSubfolder(full, { gridId: G, userId: U, name: "Images" })?.id).toBe("img-f");
    const elsewhere = ucWith([filesFolder, { id: "x", gridId: G, userId: U, name: "Images", parentId: "somewhere" }]);
    expect(findFilesSubfolder(elsewhere, { gridId: G, userId: U, name: "Images" })).toBeNull();
  });
});

describe("placementSemanticForKind — the decision this module exists to hold", () => {
  it("copies MEDIA per placement (one module, N occurrences)", () => {
    for (const k of ["image", "video", "audio", "pdf", "code"]) {
      expect(placementSemanticForKind(k)).toBe("copy");
    }
  });

  it("MULTI-PARENTS a markdown artifact — textmap lives on the OCCURRENCE", () => {
    // Two occurrences of one markdown module would carry two independent
    // bodies: you'd edit the copy on your day page and the one in Files would
    // still show the old text. createPageInContainer carries the same warning.
    expect(placementSemanticForKind("markdown")).toBe("multiparent");
  });
});

describe("resolveFilesFolderId", () => {
  it("homes a file into its kind's subfolder when none is named", () => {
    expect(resolveFilesFolderId(full, { gridId: G, userId: U, kind: "image" })).toBe("img-f");
    expect(resolveFilesFolderId(full, { gridId: G, userId: U, kind: "pdf" })).toBe("doc-f");
  });

  it("falls back to the Files folder when the subfolder is not minted yet", () => {
    const bare = ucWith([filesFolder]);
    expect(resolveFilesFolderId(bare, { gridId: G, userId: U, kind: "image" })).toBe("files-f");
  });

  it("returns the Files folder itself when no kind is given", () => {
    expect(resolveFilesFolderId(full, { gridId: G, userId: U })).toBe("files-f");
  });

  it("accepts a named folder INSIDE Files, at any depth", () => {
    const nested = ucWith([filesFolder, images, { id: "deep", gridId: G, userId: U, name: "2026", parentId: "img-f" }]);
    expect(resolveFilesFolderId(nested, { gridId: G, userId: U, parentFolderId: "deep" })).toBe("deep");
  });

  it("REFUSES a folder outside Files rather than writing there", () => {
    const uc = ucWith([filesFolder, { id: "notes", gridId: G, userId: U, name: "Notes" }]);
    expect(resolveFilesFolderId(uc, { gridId: G, userId: U, parentFolderId: "notes" })).toBeNull();
  });

  it("REFUSES another user's folder even if it sits under a Files folder", () => {
    const uc = ucWith([filesFolder, { id: "theirs", gridId: G, userId: "u2", name: "Images", parentId: "files-f" }]);
    expect(resolveFilesFolderId(uc, { gridId: G, userId: U, parentFolderId: "theirs" })).toBeNull();
  });

  it("returns null on a grid with no Files folder — never a silent fallback", () => {
    expect(resolveFilesFolderId(ucWith([]), { gridId: G, userId: U, kind: "image" })).toBeNull();
  });

  it("terminates on a cyclic folder chain instead of spinning", () => {
    const uc = ucWith([
      filesFolder,
      { id: "a", gridId: G, userId: U, name: "A", parentId: "b" },
      { id: "b", gridId: G, userId: U, name: "B", parentId: "a" },
    ]);
    expect(resolveFilesFolderId(uc, { gridId: G, userId: U, parentFolderId: "a" })).toBeNull();
  });
});
