// __tests__/moduleGridStamp.test.js
//
// A module created through the UI was persisted with NO gridId, so the next
// full_state — which is scoped by grid — never sent it back, and the container
// it described VANISHED on reload, leaving a module-less occurrence behind.
// Measured on a brand-new account 2026-08-18: "Add container" on a page wrote
// occurrence.gridId correctly and module.gridId `undefined`.
//
// The client call sites are the symptom (ModulePage's quick-add, two in
// dropHandlers), the server is the CLASS: it already stamps userId on every
// create, because a socket knows who it belongs to. It knows which grid too —
// `socket.data.activeGridId`, set by request_full_state — so the same rule
// covers every caller that forgets, present and future.
import { describe, it, expect, vi, beforeEach } from "vitest";

const findOneAndUpdate = vi.fn(async () => ({}));
vi.mock("../models/Module.js", () => ({ default: { findOneAndUpdate } }));

function harness(activeGridId = "g1") {
  const handlers = {};
  const socket = {
    on: (ev, fn) => { handlers[ev] = fn; },
    emit: () => {}, to: () => ({ emit: () => {} }),
    join: () => {}, leave: () => {},
    data: { activeGridId },
    userId: "u1",
  };
  return { handlers, socket };
}

async function register(h) {
  const mod = await import("../socketHandlers/crud.js");
  (mod.registerCrudHandlers || mod.default)(h.socket, {
    ensureUserCache: () => ({ modulesById: {}, occurrencesById: {} }),
    userCacheReady: () => true,
    loadUserIntoCache: async () => {},
    userRoom: () => "user:u1",
    gridRoom: () => "grid:u1",
  });
}

beforeEach(() => findOneAndUpdate.mockClear());

describe("create_module", () => {
  it("stamps the socket's active grid when the caller omits gridId", async () => {
    const h = harness("g1");
    await register(h);
    await h.handlers["create_module"]({ module: { id: "m1", role: "container", kind: "board", label: "Sessions" } });
    expect(findOneAndUpdate).toHaveBeenCalled();
    const [, doc] = findOneAndUpdate.mock.calls[0];
    expect(doc.gridId, "a module with no gridId is invisible to full_state").toBe("g1");
  });

  // The control — the stamp must not overwrite a caller that DOES say which
  // grid, or a template/import writing into another grid would be re-homed.
  it("leaves an explicit gridId alone", async () => {
    const h = harness("g1");
    await register(h);
    await h.handlers["create_module"]({ module: { id: "m2", role: "container", gridId: "g-other" } });
    const [, doc] = findOneAndUpdate.mock.calls[0];
    expect(doc.gridId).toBe("g-other");
  });

  // And it must not invent one: a socket that has not opened a grid yet writes
  // no gridId rather than a bogus null-shaped value.
  it("writes nothing when there is no active grid and none was given", async () => {
    const h = harness(null);
    await register(h);
    await h.handlers["create_module"]({ module: { id: "m3", role: "container" } });
    const [, doc] = findOneAndUpdate.mock.calls[0];
    expect(doc.gridId ?? null).toBe(null);
  });
});
