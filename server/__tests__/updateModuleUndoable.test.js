// `update_module` RECORDED NOTHING, so every module-level edit was invisible to undo: renaming a row or a
// container (its module label), Settings › Fields binding edits, a module's style, its default drag mode.
// Found 2026-10-11 renaming an Ideas row by clicking: no transaction named the module at all.
import { describe, it, expect, vi, beforeEach } from "vitest";

const recorded = [];
vi.mock("../utils/txRecorder.js", () => ({ recordDoc: (args) => { recorded.push(args); } }));
vi.mock("../models/Module.js", () => ({ default: { findOneAndUpdate: async () => ({}) } }));
vi.mock("../models/Occurrence.js", () => ({ default: { findOneAndUpdate: async () => ({}) } }));

async function fire(payload, cached) {
  const handlers = {};
  const socket = {
    on: (ev, fn) => { handlers[ev] = fn; },
    emit: () => {}, to: () => ({ emit: () => {} }), join: () => {}, leave: () => {},
    data: { activeGridId: "g1" }, userId: "u1",
  };
  const uc = { modulesById: cached ? { [cached.id]: { ...cached } } : {}, occurrencesById: {} };
  const mod = await import("../socketHandlers/crud.js");
  (mod.registerCrudHandlers || mod.default)(socket, {
    ensureUserCache: () => uc, userCacheReady: () => true, loadUserIntoCache: async () => {},
    userRoom: () => "user:u1", gridRoom: () => "grid:u1", createOccurrenceData: (o) => o,
  });
  await handlers["update_module"](payload);
  return { uc };
}

beforeEach(() => { recorded.length = 0; });

describe("update_module is undoable", () => {
  it("records the module's before and after under the gesture's actionId", async () => {
    await fire({ module: { id: "m1", label: "New name" }, __actionId: "a1" }, { id: "m1", label: "Old name", role: "instance", userId: "u1" });
    const r = recorded.find((x) => x.model === "module" && x.id === "m1");
    expect(r, "the rename was never recorded — undo cannot see it").toBeTruthy();
    expect(r.before.label).toBe("Old name");
    expect(r.after.label).toBe("New name");
    expect(r.actionId).toBe("a1");
  });
  it("control: the write itself still lands in the cache", async () => {
    const { uc } = await fire({ module: { id: "m1", label: "New name" } }, { id: "m1", label: "Old name", userId: "u1" });
    expect(uc.modulesById.m1.label).toBe("New name");
  });
});
