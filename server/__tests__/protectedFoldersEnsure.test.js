// server/__tests__/protectedFoldersEnsure.test.js
//
// A grid created from the Toolbar never ran 0035/0049, so it had no protected
// Templates or Files folder and "Save as new template" silently did nothing.
// Bootstrap now mints both. These pin: mint on a bare grid, the result is what
// the READERS (findTemplatesFolder / resolveFilesFolderId) accept, no-op when
// present, adopt-not-duplicate, and no query at all on the warm path.
import { describe, it, expect, vi, beforeEach } from "vitest";

const writes = [];
vi.mock("../models/Folder.js", () => ({
  default: {
    findOneAndUpdate: vi.fn((q, doc) => { writes.push(["upsert", doc]); return { lean: async () => ({ ...doc }) }; }),
    updateOne: vi.fn(async (q, u) => { writes.push(["update", q, u]); }),
  },
}));

const { ensureProtectedFolders } = await import("../utils/protectedFoldersEnsure.js");
const { findTemplatesFolder, resolveTemplatesFolderId } = await import("../utils/templatesFolder.js");
const { findFilesFolder, resolveFilesFolderId } = await import("../utils/filesFolder.js");

const G = "g1", U = "u1", ROOT = "usr-root-g1";
const manifest = { id: "usr-mfst-g1", rootFolderId: ROOT };
const root = { id: ROOT, gridId: G, userId: U, name: "Root", parentId: null };
const ucWith = (...folders) => ({ foldersById: Object.fromEntries([root, ...folders].map(f => [f.id, f])) });

beforeEach(() => { writes.length = 0; });

describe("ensureProtectedFolders", () => {
  it("mints Templates and Files (+4 subfolders) on a bare grid, where the readers find them", async () => {
    const uc = ucWith();
    // CONTROL: the bare grid is the reported failure.
    expect(resolveTemplatesFolderId(uc, { gridId: G, userId: U })).toBeNull();

    await ensureProtectedFolders({ gridId: G, userId: U, uc, manifest });

    const tpl = findTemplatesFolder(uc, { gridId: G, userId: U });
    expect(tpl).toMatchObject({ id: `tpl-folder-${G}`, parentId: ROOT, meta: { protected: true } });
    expect(resolveTemplatesFolderId(uc, { gridId: G, userId: U })).toBe(tpl.id);

    const files = findFilesFolder(uc, { gridId: G, userId: U });
    expect(files).toMatchObject({ parentId: ROOT, meta: { protected: true } });
    const subs = Object.values(uc.foldersById).filter(f => f.parentId === files.id);
    expect(subs.map(f => f.name).sort()).toEqual(["Audio", "Documents", "Images", "Video"]);
    expect(subs.every(f => !f.meta?.protected)).toBe(true);
    expect(resolveFilesFolderId(uc, { gridId: G, userId: U, kind: "image" }))
      .toBe(subs.find(f => f.name === "Images").id);
  });

  it("writes nothing when both folders already exist (the every-load path)", async () => {
    const uc = ucWith();
    await ensureProtectedFolders({ gridId: G, userId: U, uc, manifest });
    writes.length = 0;
    await ensureProtectedFolders({ gridId: G, userId: U, uc, manifest });
    expect(writes).toEqual([]);
  });

  it("keeps a migrated grid's protected Templates folder wherever it lives", async () => {
    const existing = { id: "tpl-old", gridId: G, userId: U, name: "Templates", parentId: "lib", meta: { protected: true } };
    const uc = ucWith(existing);
    await ensureProtectedFolders({ gridId: G, userId: U, uc, manifest });
    expect(Object.values(uc.foldersById).filter(f => f.name === "Templates")).toHaveLength(1);
    expect(writes.some(([, d]) => d?.name === "Templates")).toBe(false);
  });

  it("adopts an unprotected same-named folder under the root instead of minting a second", async () => {
    const mine = { id: "mine", gridId: G, userId: U, name: "Templates", parentId: ROOT };
    const uc = ucWith(mine);
    await ensureProtectedFolders({ gridId: G, userId: U, uc, manifest });
    expect(Object.values(uc.foldersById).filter(f => f.name === "Templates")).toHaveLength(1);
    expect(findTemplatesFolder(uc, { gridId: G, userId: U })?.id).toBe("mine");
    expect(writes).toContainEqual(["update", { id: "mine", userId: U }, { $set: { "meta.protected": true } }]);
  });

  it("does nothing without a root folder to hang them off", async () => {
    const uc = ucWith();
    expect(await ensureProtectedFolders({ gridId: G, userId: U, uc, manifest: {} })).toBeNull();
    expect(writes).toEqual([]);
  });
});
