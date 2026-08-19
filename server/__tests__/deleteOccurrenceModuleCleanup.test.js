// __tests__/deleteOccurrenceModuleCleanup.test.js
//
// Deleting an occurrence never removed its MODULE. Measured on claude-grid
// after one sitting of ordinary use: 64 modules placing 49 occurrences — 15
// orphans, every one a row or container that had been deleted or converted.
//
// The decision is `planOrphanModules`, unchanged, so these tests are about the
// WIRING and the refusals reaching it: a module that still has a placement, a
// template root, and anything an operation or a textmap names must survive a
// delete.
import { describe, it, expect, vi, beforeEach } from "vitest";

const deletedModules = [];
const deletedOccurrences = [];

vi.mock("../models/Module.js", () => ({
  default: { findOneAndDelete: async ({ id }) => { deletedModules.push(id); return {}; } },
}));
vi.mock("../models/Occurrence.js", () => ({
  default: {
    findOneAndDelete: async ({ id }) => { deletedOccurrences.push(id); return {}; },
    findOne: () => ({ lean: async () => null }),
    updateMany: async () => ({}),
    findOneAndUpdate: async () => ({}),
  },
}));
vi.mock("../models/Grid.js", () => ({ default: { findOne: () => ({ lean: async () => null }) } }));
vi.mock("../utils/txRecorder.js", () => ({ recordDoc: () => {} }));

// A module minted long enough ago that the sweep's age floor is not what is
// being measured — the delete path passes minAgeMinutes: 0 on purpose.
const OLD = new Date(Date.now() - 86400000).toISOString();

function makeCache({ modules = {}, occurrences = {}, operations = {} } = {}) {
  return {
    modulesById: modules,
    occurrencesById: occurrences,
    operationsById: operations,
    fieldsById: {}, viewsById: {}, foldersById: {}, manifestsById: {},
  };
}

async function deleteOcc(uc, occurrenceId) {
  const handlers = {};
  const socket = {
    on: (ev, fn) => { handlers[ev] = fn; },
    emit: () => {}, to: () => ({ emit: () => {} }), join: () => {}, leave: () => {},
    data: { activeGridId: "g1" }, userId: "u1",
  };
  const mod = await import("../socketHandlers/crud.js");
  (mod.registerCrudHandlers || mod.default)(socket, {
    ensureUserCache: () => uc,
    userCacheReady: () => true,
    loadUserIntoCache: async () => uc,
    userRoom: () => "user:u1",
    gridRoom: () => "grid:u1",
    createOccurrenceData: (o) => o,
  });
  await handlers["delete_occurrence"]({ occurrenceId });
}

beforeEach(() => { deletedModules.length = 0; deletedOccurrences.length = 0; });

describe("delete_occurrence — the module behind the placement", () => {
  it("deletes the module when that was its last placement", async () => {
    const uc = makeCache({
      modules: { "m-row": { id: "m-row", userId: "u1", role: "instance", label: "Sweep the bench", createdAt: OLD } },
      occurrences: { "o-row": { id: "o-row", userId: "u1", moduleId: "m-row" } },
    });
    await deleteOcc(uc, "o-row");
    expect(deletedOccurrences).toContain("o-row");
    expect(deletedModules).toEqual(["m-row"]);
    expect(uc.modulesById["m-row"]).toBeUndefined();
  });

  it("KEEPS a module another occurrence still places", async () => {
    const uc = makeCache({
      modules: { "m-row": { id: "m-row", userId: "u1", role: "instance", createdAt: OLD } },
      occurrences: {
        "o-a": { id: "o-a", userId: "u1", moduleId: "m-row" },
        "o-b": { id: "o-b", userId: "u1", moduleId: "m-row" },
      },
    });
    await deleteOcc(uc, "o-a");
    expect(deletedModules).toEqual([]);
    expect(uc.modulesById["m-row"]).toBeTruthy();
  });

  it("KEEPS a template root — having no placement is its normal state", async () => {
    const uc = makeCache({
      modules: { "m-tpl": { id: "m-tpl", userId: "u1", role: "container", createdAt: OLD, meta: { templateModule: true } } },
      occurrences: { "o-tpl": { id: "o-tpl", userId: "u1", moduleId: "m-tpl" } },
    });
    await deleteOcc(uc, "o-tpl");
    expect(deletedModules).toEqual([]);
  });

  it("KEEPS a module an operation names", async () => {
    const uc = makeCache({
      modules: { "m-row": { id: "m-row", userId: "u1", role: "instance", createdAt: OLD } },
      occurrences: { "o-row": { id: "o-row", userId: "u1", moduleId: "m-row" } },
      operations: {
        "op-1": { id: "op-1", pipeline: { steps: [{ action: "CREATE", cfg: { templateId: "m-row" } }] } },
      },
    });
    await deleteOcc(uc, "o-row");
    expect(deletedModules).toEqual([]);
  });

  it("KEEPS a module a surviving textmap names", async () => {
    const uc = makeCache({
      modules: { "m-row": { id: "m-row", userId: "u1", role: "instance", createdAt: OLD } },
      occurrences: {
        "o-row": { id: "o-row", userId: "u1", moduleId: "m-row" },
        "o-doc": {
          id: "o-doc", userId: "u1", moduleId: "m-doc",
          textmap: { type: "doc", content: [{ type: "moduleEmbed", attrs: { moduleId: "m-row" } }] },
        },
      },
    });
    await deleteOcc(uc, "o-row");
    expect(deletedModules).toEqual([]);
  });

  it("sweeps the modules of a deleted SUBTREE, not just the root", async () => {
    const uc = makeCache({
      modules: {
        "m-parent": { id: "m-parent", userId: "u1", role: "container", createdAt: OLD },
        "m-child": { id: "m-child", userId: "u1", role: "instance", createdAt: OLD },
      },
      occurrences: {
        "o-parent": { id: "o-parent", userId: "u1", moduleId: "m-parent", occurrences: ["o-child"] },
        "o-child": { id: "o-child", userId: "u1", moduleId: "m-child", parentId: "o-parent" },
      },
    });
    await deleteOcc(uc, "o-parent");
    expect(deletedOccurrences.sort()).toEqual(["o-child", "o-parent"]);
    expect(deletedModules.sort()).toEqual(["m-child", "m-parent"]);
  });
});
