// __tests__/createPageApplyTemplateRace.test.js
//
// Pins the Task 5 review finding: create_page (socketHandlers/crud.js) and
// apply_template (socketHandlers/templates.js) are two DIFFERENT socket
// handlers, fired back-to-back by the client's create-page-from-template
// flow (ManifestTree.jsx handleCreatePageFromTemplate / ModulePanel.jsx
// handlePanelCreatePageFromTemplate). create_page does real Mongo round-trips
// before the new occurrence lands in the warm cache; apply_template used to
// read that cache with no wait at all — so if apply_template's frame got
// processed while create_page was still mid-flight, the target resolved to
// undefined and the template silently failed to apply.
//
// This test drives the REAL handler functions (not a reimplementation) with
// every Mongoose call mocked to resolve after a delay — the same shape as an
// actual Atlas round-trip — and fires create_page then apply_template
// SYNCHRONOUSLY, back-to-back, without awaiting the first. That is exactly
// the client's calling pattern and exactly the interleaving that used to
// race. It NEVER touches a database.
import { describe, it, expect, vi, beforeEach } from "vitest";

function delayed(ms, value) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

vi.mock("../models/Module.js", () => ({
  default: { findOneAndUpdate: vi.fn(() => delayed(15, {})) },
}));
vi.mock("../models/View.js", () => ({
  default: { findOneAndUpdate: vi.fn(() => delayed(5, {})) },
}));
vi.mock("../models/Occurrence.js", () => ({
  default: { findOneAndUpdate: vi.fn(() => delayed(15, {})) },
}));
vi.mock("../utils/cloneSubtree.js", () => ({
  cloneSubtree: vi.fn(async () => ({
    rootClonedOccurrenceId: "cloned-root-1",
    occurrenceIds: ["cloned-root-1"],
    moduleIds: [],
  })),
  // mode:"merge" (what the create-page-from-template flow sends) routes here.
  mergeSubtreeInto: vi.fn(async () => ({
    occurrenceIds: ["cloned-root-1"],
    moduleIds: [],
    updatedParentIds: [],
  })),
}));

const { registerCrudHandlers } = await import("../socketHandlers/crud.js");
const { registerTemplateHandlers } = await import("../socketHandlers/templates.js");

// Minimal fake socket: an event bus plus the handful of properties/methods
// both handler files read off it. No real network involved.
function makeSocket(userId, gridId) {
  const listeners = {};
  return {
    userId,
    data: { activeGridId: gridId },
    on(event, fn) { listeners[event] = fn; },
    emit: vi.fn(),
    to: () => ({ emit: vi.fn() }),
    trigger(event, payload) { return listeners[event](payload); },
  };
}

// Deps shared by both registration functions — a tiny in-memory stand-in for
// server.js's real ensureUserCache/loadUserIntoCache. The critical property
// (matching the real server.js) is that ensureUserCache ALWAYS returns the
// SAME object instance for a given (userId, gridId) — that's what makes a
// pending-create entry registered by one handler visible to the other.
function makeDeps(userId, gridId) {
  const cacheByUser = {};
  const key = `${userId}:${gridId}`;
  return {
    ensureUserCache: () => {
      if (!cacheByUser[key]) {
        cacheByUser[key] = {
          _loaded: true,
          modulesById: {}, occurrencesById: {}, viewsById: {},
          fieldsById: {}, manifestsById: {}, foldersById: {}, operationsById: {},
        };
      }
      return cacheByUser[key];
    },
    userCacheReady: () => true,
    loadUserIntoCache: async () => cacheByUser[key],
    getAllGridsForUser: async () => [],
    userRoom: (u) => `user:${u}`,
    gridRoom: (g) => `grid:${g}`,
    getOccurrencesForGrid: () => [],
    createOccurrenceData: (p) => ({ ...p }),
  };
}

describe("create_page -> apply_template ordering (Task 5 review Finding 1)", () => {
  const userId = "user-1";
  const gridId = "grid-1";

  it("apply_template applies onto the just-created page instead of racing its Mongo writes", async () => {
    const deps = makeDeps(userId, gridId);
    const socket = makeSocket(userId, gridId);
    registerCrudHandlers(socket, deps);
    registerTemplateHandlers(socket, deps);

    const modId = "mod-new-page";
    const occId = "occ-new-page";

    // Fire create_page WITHOUT awaiting it, then immediately (same tick) fire
    // apply_template targeting the occurrence it just minted — the exact
    // shape of CommitHelpers.createPagePinnedToPanel followed synchronously
    // by CommitHelpers.commitApplyTemplate.
    const createPromise = socket.trigger("create_page", {
      module: { id: modId, userId, gridId, role: "page", kind: "board", label: "Board Page" },
      occurrence: { id: occId, userId, gridId, parentId: null, fields: {} },
      panelOccurrenceId: null,
    });
    const applyPromise = socket.trigger("apply_template", {
      templateOccurrenceId: "template-1",
      targetOccurrenceId: occId,
      mode: "merge",
    });

    await Promise.all([createPromise, applyPromise]);

    const emittedEvents = socket.emit.mock.calls.map(([event]) => event);
    expect(emittedEvents).not.toContain("server_error");
    expect(emittedEvents).toContain("template_applied");
  });
});
