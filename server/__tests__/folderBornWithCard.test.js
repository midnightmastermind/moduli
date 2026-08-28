// __tests__/folderBornWithCard.test.js
//
// A sub-folder renders on its parent's folder PAGE only if it CONTAINS a
// `role:"page" kind:"folder"` occurrence — that occurrence IS the card. The
// sidebar reads `foldersById` directly, so a card-less folder shows in the tree
// and is INVISIBLE on the page, which is why it reads as data loss. Reported
// 2026-08-24 and again 2026-08-28 ("none of my documents are showing up").
//
// The client mints one lazily on view, but only for the DIRECT children of the
// folder on screen — so a grandchild stays card-less and its parent's preview
// renders empty. Fixed at the CHOKEPOINT instead: there are seven client call
// sites for `createFolder` plus the assistant tool, and adding a mint to each
// is the "the eighth caller forgets" trap. The server already stamps
// userId/gridId here for exactly that reason (2026-08-18).
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = { folders: new Map(), modules: new Map(), occurrences: new Map() };
const upsert = (store) => vi.fn(async (filter, doc) => {
  const id = filter.id; store.set(id, { ...(store.get(id) || {}), ...(doc.$set || doc) }); return store.get(id);
});
vi.mock("../models/Folder.js", () => ({ default: { findOneAndUpdate: upsert(db.folders) } }));
vi.mock("../models/Module.js", () => ({ default: { findOneAndUpdate: upsert(db.modules) } }));
vi.mock("../models/Occurrence.js", () => ({ default: { findOneAndUpdate: upsert(db.occurrences), find: vi.fn(() => ({ lean: async () => [] })) } }));
for (const m of ["Grid", "Field", "Operation", "Manifest", "View"])
  vi.doMock(`../models/${m}.js`, () => ({ default: {} }));
vi.mock("../models/Grid.js", () => ({ default: {} }));
vi.mock("../models/Field.js", () => ({ default: {} }));
vi.mock("../models/Operation.js", () => ({ default: {} }));
vi.mock("../models/Manifest.js", () => ({ default: {} }));
vi.mock("../models/View.js", () => ({ default: {} }));
vi.mock("../utils/txRecorder.js", () => ({ recordDoc: vi.fn(), flushAction: vi.fn(), flushAll: vi.fn(), closeAction: vi.fn() }));

const { registerCrudHandlers } = await import("../socketHandlers/crud.js");

describe("a folder is born with its card", () => {
  let handlers, uc, socket, emitted;
  const fire = (e) => (...a) => Promise.all((handlers.get(e) || []).map(fn => fn(...a)));

  beforeEach(() => {
    db.folders.clear(); db.modules.clear(); db.occurrences.clear();
    handlers = new Map(); emitted = [];
    uc = { foldersById: {}, modulesById: {}, occurrencesById: {}, viewsById: {}, manifestsById: {}, fieldsById: {}, operationsById: {}, gridsById: {} };
    socket = {
      id: "s1", userId: "u1", data: { activeGridId: "g1" },
      on: (e, fn) => handlers.set(e, [...(handlers.get(e) || []), fn]),
      emit: (e, p) => emitted.push({ to: "self", e, p }),
      to: () => ({ emit: (e, p) => emitted.push({ to: "room", e, p }) }),
    };
    registerCrudHandlers(socket, {
      ensureUserCache: () => uc, userCacheReady: () => true, loadUserIntoCache: vi.fn(),
      getAllGridsForUser: vi.fn(async () => []), userRoom: (u) => `user:${u}`, gridRoom: (g) => `grid:${g}`,
      getOccurrencesForGrid: vi.fn(() => []), createOccurrenceData: vi.fn((o) => o),
    });
  });

  const cards = () => [...db.occurrences.values()].filter(o => o.meta?.folderPage === true);

  it("creating a folder also creates its folder-page card", async () => {
    await fire("create_folder")({ folder: { name: "Documents", gridId: "g1" } });
    const folder = [...db.folders.values()][0];
    expect(folder).toBeTruthy();
    expect(cards()).toHaveLength(1);
    expect(cards()[0].parentId).toBe(folder.id);
  });

  it("the card is a page/folder MODULE — the shape the renderer looks for", async () => {
    // The renderer identifies a card by the MODULE's kind+role, not by
    // `meta.folderPage`. Getting the module wrong makes the card invisible
    // while every count still says it exists.
    await fire("create_folder")({ folder: { name: "Media", gridId: "g1" } });
    const mod = db.modules.get(cards()[0].moduleId);
    expect(mod).toMatchObject({ role: "page", kind: "folder", label: "Media" });
  });

  it("EMITS TO THE ORIGINATING TAB TOO — `socket.to(room)` excludes the sender", async () => {
    // Without the self-emit the tab that made the folder does not learn about
    // its card, so the folder it just created looks empty until a reload.
    await fire("create_folder")({ folder: { name: "Notes", gridId: "g1" } });
    const self = emitted.filter(x => x.to === "self").map(x => x.e);
    expect(self).toContain("module_created");
    expect(self).toContain("occurrence_created");
  });

  it("a `category` folder gets NO card — it is not a tree node", async () => {
    await fire("create_folder")({ folder: { name: "Bill Ops", gridId: "g1", folderType: "category" } });
    expect(db.folders.size).toBe(1);
    expect(cards()).toHaveLength(0);
  });

  it("re-creating the same folder does NOT mint a second card", async () => {
    // Two cards make each render the OTHER as a sub-folder — "a trackers folder
    // with trackers inside the trackers folder all the way down" (2026-08-25).
    await fire("create_folder")({ folder: { name: "Docs", gridId: "g1" } });
    await fire("create_folder")({ folder: { name: "Docs", gridId: "g1" } });
    expect(cards()).toHaveLength(1);
  });

  it("the folder still succeeds when the card cannot be written", async () => {
    // Best-effort by design: a folder with no card is the OLD behaviour and is
    // recoverable on view. Failing the folder over its card is strictly worse.
    const Module = (await import("../models/Module.js")).default;
    Module.findOneAndUpdate.mockRejectedValueOnce(new Error("mongo down"));
    await fire("create_folder")({ folder: { name: "Resilient", gridId: "g1" } });
    expect([...db.folders.values()].some(f => f.name === "Resilient")).toBe(true);
  });
});
