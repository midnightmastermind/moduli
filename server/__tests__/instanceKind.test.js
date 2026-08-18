// __tests__/instanceKind.test.js
//
// Every row created by clicking "+ Item" was born with `kind: "board"` — an
// INSTANCE has no sub-types, and `getModuleTypeIcon` resolves kind BEFORE role,
// so all 31 rows of claude-grid drew the board icon and `checkGrid` reported
// them as `inert-kind`. That is the exact defect migration 0003 swept 525 of
// off the live grid on 2026-07-29 (the seed was fixed then; this create path
// was not), and the same one fixed for panels earlier today.
//
// The handler forced a kind of its own (`instance.kind || "list"`), so even a
// caller that sent none got one. It sends nothing now.
import { describe, it, expect, vi, beforeEach } from "vitest";

const saved = [];
class FakeModule {
  constructor(doc) { this.doc = doc; Object.assign(this, doc); }
  async save() { saved.push(this.doc); }
  toObject() { return { ...this.doc }; }
}
vi.mock("../models/Module.js", () => ({ default: FakeModule }));
vi.mock("../models/Occurrence.js", () => ({ default: { findOneAndUpdate: async () => ({}) } }));

function harness() {
  const handlers = {};
  const socket = {
    on: (ev, fn) => { handlers[ev] = fn; },
    emit: () => {}, to: () => ({ emit: () => {} }), join: () => {}, leave: () => {},
    data: { activeGridId: "g1" }, userId: "u1",
  };
  return { handlers, socket };
}
async function fire(instance) {
  const h = harness();
  const mod = await import("../socketHandlers/crud.js");
  (mod.registerCrudHandlers || mod.default)(h.socket, {
    ensureUserCache: () => ({ modulesById: {}, occurrencesById: {} }),
    userCacheReady: () => true, loadUserIntoCache: async () => {},
    userRoom: () => "user:u1", gridRoom: () => "grid:u1",
    createOccurrenceData: (o) => o,
  });
  await h.handlers["create_instance_in_container"]({ containerId: "c1", instance });
  return saved[saved.length - 1];
}

beforeEach(() => { saved.length = 0; });

describe("create_instance_in_container", () => {
  it("does not stamp a kind — an instance has no sub-types", async () => {
    const doc = await fire({ id: "i1", label: "Aug 3 — first real edge" });
    expect(doc.kind ?? null).toBe(null);
  });

  it("drops a kind the caller sent, for the same reason", async () => {
    const doc = await fire({ id: "i2", label: "row", kind: "board" });
    expect(doc.kind ?? null).toBe(null);
  });

  // The control: the rest of the module is still built, so "no kind" is not
  // "no module".
  it("still saves the module it was asked for", async () => {
    const doc = await fire({ id: "i3", label: "row", fieldBindings: [{ fieldId: "f1" }] });
    expect(doc).toMatchObject({ id: "i3", role: "instance", label: "row", gridId: "g1", userId: "u1" });
    expect(doc.fieldBindings).toHaveLength(1);
  });
});
