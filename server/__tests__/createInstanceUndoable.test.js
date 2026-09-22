// __tests__/createInstanceUndoable.test.js
//
// `create_instance_in_container` RECORDED NOTHING, so every gesture behind it
// was invisible to Ctrl+Z: the canvas double-click that mints a card, the
// pool's add box, the radial's "Duplicate (new instance)". Measured on the
// rebuild grid 2026-09-22 — the same hole `break_link` still has, and the one
// `createPageInContainer` / `addBookmarkOccurrence` had on the client side.
//
// The contract is `create_occurrence`'s (crud.js ~1612): the new row goes in
// with `before: null` (undo deletes it) and the parent's list write goes in
// beside it under the SAME actionId, so one press takes both back and leaves
// no occurrence parented-but-listed-by-nobody.
import { describe, it, expect, vi, beforeEach } from "vitest";

const recorded = [];
vi.mock("../utils/txRecorder.js", () => ({
  recordDoc: (args) => { recorded.push(args); },
}));
class FakeModule {
  constructor(doc) { Object.assign(this, doc); this.doc = doc; }
  async save() {}
  toObject() { return { ...this.doc }; }
}
vi.mock("../models/Module.js", () => ({ default: FakeModule }));
vi.mock("../models/Occurrence.js", () => ({ default: { findOneAndUpdate: async () => ({}) } }));

const CONTAINER_OCC = { id: "co1", moduleId: "c1", occurrences: ["existing"] };

async function fire(payload) {
  const handlers = {};
  const socket = {
    on: (ev, fn) => { handlers[ev] = fn; },
    emit: () => {}, to: () => ({ emit: () => {} }), join: () => {}, leave: () => {},
    data: { activeGridId: "g1" }, userId: "u1",
  };
  const uc = { modulesById: {}, occurrencesById: { co1: { ...CONTAINER_OCC } } };
  const mod = await import("../socketHandlers/crud.js");
  (mod.registerCrudHandlers || mod.default)(socket, {
    ensureUserCache: () => uc,
    userCacheReady: () => true, loadUserIntoCache: async () => {},
    userRoom: () => "user:u1", gridRoom: () => "grid:u1",
    createOccurrenceData: (o) => o,
  });
  await handlers["create_instance_in_container"](payload);
  return { uc };
}

beforeEach(() => { recorded.length = 0; });

const occRecords = () => recorded.filter((r) => r.model === "occurrence");

describe("create_instance_in_container is undoable", () => {
  it("records the new row as a CREATE (before: null — undo deletes it)", async () => {
    await fire({ containerId: "c1", occurrenceId: "o9", __actionId: "a1", instance: { id: "m9", label: "New card" } });
    const row = occRecords().find((r) => r.id === "o9");
    expect(row, "the new row was never recorded — undo cannot see it").toBeTruthy();
    expect(row.before).toBeNull();
    expect(row.after?.id).toBe("o9");
  });

  it("records the parent's list write too, so undo leaves no orphan", async () => {
    await fire({ containerId: "c1", occurrenceId: "o9", __actionId: "a1", instance: { id: "m9", label: "New card" } });
    const parent = occRecords().find((r) => r.id === "co1");
    expect(parent, "the parent's occurrences[] write was not recorded").toBeTruthy();
    expect(parent.before.occurrences, "before must be the list WITHOUT the new row").toEqual(["existing"]);
    expect(parent.after.occurrences).toEqual(["existing", "o9"]);
  });

  it("both docs carry the client's actionId — ONE undo step, not two", async () => {
    await fire({ containerId: "c1", occurrenceId: "o9", __actionId: "a1", instance: { id: "m9", label: "New card" } });
    const ids = [...new Set(occRecords().map((r) => r.actionId))];
    expect(occRecords().length).toBe(2);
    expect(ids).toEqual(["a1"]);
  });

  // CONTROL — an unstamped write (a script, an op) still records, marked
  // derived by the recorder itself. Recording must not depend on the stamp.
  it("records even with no actionId", async () => {
    await fire({ containerId: "c1", occurrenceId: "o9", instance: { id: "m9", label: "New card" } });
    expect(occRecords().length).toBe(2);
    expect(occRecords().every((r) => r.actionId === null)).toBe(true);
  });
});
