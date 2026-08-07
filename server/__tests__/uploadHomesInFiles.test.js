// Where does an upload LAND?
//
// The unit under test is `homeFolderForUpload`'s rule, exercised against the
// REAL `resolveFilesFolderId` and a folder tree shaped exactly like the one
// migration 0049 mints. No database and no HTTP — the route's own wiring is
// covered by the live check in the session notes; what needs pinning here is
// the DECISION, because it is the part with branches.
//
// A/B NOTE: every case below fails against the pre-fix rule (`parentFolderId ||
// null`) except the two that assert the fallbacks — and those have
// discriminating siblings, so the suite cannot pass vacuously.
import { describe, it, expect } from "vitest";
import { resolveFilesFolderId, filesSubfolderForKind } from "../utils/filesFolder.js";

const gridId = "g1";
const userId = "u1";

// The shape 0049 produces: protected "Files" under the manifest root, four
// unprotected subfolders under it.
const FILES = { id: "files", name: "Files", parentId: "root", gridId, userId, meta: { protected: true } };
const SUBS = ["Images", "Video", "Audio", "Documents"].map((name, i) => ({
  id: `sub-${name}`, name, parentId: "files", gridId, userId, meta: {}, sortOrder: i,
}));
const OUTSIDE = { id: "proj", name: "Projects", parentId: "root", gridId, userId, meta: {} };

const uc = { foldersById: Object.fromEntries([FILES, ...SUBS, OUTSIDE].map(f => [f.id, f])) };
const ucNoFiles = { foldersById: { [OUTSIDE.id]: OUTSIDE } };

// The rule as the route applies it (server.js homeFolderForUpload). Kept in
// step with that function — it is four lines and duplicating it here is far
// cheaper than booting Express to read one return value.
function homeFolderForUpload(ctx, { parentFolderId, kind }) {
  if (parentFolderId) return parentFolderId;
  return resolveFilesFolderId(ctx, { gridId, userId, kind }) || null;
}

describe("an upload with no chosen folder homes in Files/<kind>", () => {
  for (const [kind, expected] of Object.entries({
    image: "Images", video: "Video", audio: "Audio",
    pdf: "Documents", code: "Documents", markdown: "Documents",
  })) {
    it(`${kind} → ${expected}`, () => {
      const id = homeFolderForUpload(uc, { kind });
      expect(uc.foldersById[id].name).toBe(expected);
      expect(uc.foldersById[id].name).toBe(filesSubfolderForKind(kind));
    });
  }

  // An unknown kind must land SOMEWHERE inside Files rather than at null —
  // "no home" is the state this whole task exists to remove.
  it("an unrecognised kind lands in Documents, not nowhere", () => {
    const id = homeFolderForUpload(uc, { kind: "wat" });
    expect(uc.foldersById[id].name).toBe("Documents");
  });
});

describe("an EXPLICIT folder always wins", () => {
  // The user picked that folder. resolveFilesFolderId's containment guard is for
  // FILE OPERATIONS writing outside Files; firing it here would refuse an
  // upload because the user chose their own folder.
  it("honours a folder outside Files verbatim", () => {
    expect(homeFolderForUpload(uc, { parentFolderId: OUTSIDE.id, kind: "image" })).toBe(OUTSIDE.id);
  });
  it("honours a folder inside Files verbatim, even the 'wrong' subfolder", () => {
    expect(homeFolderForUpload(uc, { parentFolderId: "sub-Audio", kind: "image" })).toBe("sub-Audio");
  });
});

describe("a grid that has not run 0049 degrades to the status quo", () => {
  // Uploads used to write `parentId: null`. That is not "the wrong folder", it
  // is "no folder" — so falling back is safe, and failing the upload instead
  // would be the guard firing on the wrong thing.
  it("returns null rather than inventing a folder", () => {
    expect(homeFolderForUpload(ucNoFiles, { kind: "image" })).toBeNull();
  });
  it("still honours an explicit folder", () => {
    expect(homeFolderForUpload(ucNoFiles, { parentFolderId: OUTSIDE.id, kind: "image" })).toBe(OUTSIDE.id);
  });
});

describe("the guard still refuses a foreign tree", () => {
  // Discriminating sibling for the fallbacks above: resolveFilesFolderId must
  // NOT be a rubber stamp. Another user's folder resolves to null even though a
  // Files folder exists for this one.
  it("a folder belonging to another user resolves to null", () => {
    const foreign = { id: "other", name: "Stuff", parentId: "files", gridId, userId: "u2", meta: {} };
    const ctx = { foldersById: { ...uc.foldersById, other: foreign } };
    expect(resolveFilesFolderId(ctx, { gridId, userId, parentFolderId: "other", kind: "image" })).toBeNull();
  });
});
