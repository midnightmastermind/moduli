// __tests__/createGridAck.test.js
//
// "Add new grid" was a dead button. `handleCreateNewGrid` cleared the stored
// gridId and re-requested full state — but `request_full_state` only MINTS a
// grid for a user who has none (state.js); otherwise it falls back to the
// default-flagged or oldest grid. Measured on a fresh account 2026-08-18: same
// grid label and same gridId before and after the click.
//
// The client now emits `create_grid` and waits for the server's own
// acknowledgement before switching. This pins the half that made the switch
// possible: the caller is acked, not only the other windows. Without it the
// client has no signal that the upsert landed, and a state request that
// arrives first falls back to the OLD grid — the bug wearing a new hat.
import { describe, it, expect, vi, beforeEach } from "vitest";

const findOneAndUpdate = vi.fn(() => ({ lean: async () => ({ _id: "g-new", name: "", rows: 1, cols: 1 }) }));
vi.mock("../models/Grid.js", () => ({ default: { findOneAndUpdate } }));

function harness() {
  const handlers = {};
  const toSelf = [];
  const toOthers = [];
  const socket = {
    on: (ev, fn) => { handlers[ev] = fn; },
    emit: (ev, payload) => toSelf.push([ev, payload]),
    to: () => ({ emit: (ev, payload) => toOthers.push([ev, payload]) }),
    join: () => {}, leave: () => {}, data: {},
    userId: "u1",          // registerCrudHandlers reads socket.userId, not deps
  };
  return { handlers, toSelf, toOthers, socket };
}

async function fireCreateGrid(h, grid) {
  const mod = await import("../socketHandlers/crud.js");
  const register = mod.registerCrudHandlers || mod.default;
  register(h.socket, {
    userRoom: () => "user:u1",
    gridRoom: () => "grid:u1",
    io: { to: () => ({ emit: () => {} }) },
  });
  await h.handlers["create_grid"]({ grid });
}

beforeEach(() => { findOneAndUpdate.mockClear(); });

describe("create_grid", () => {
  it("acknowledges the CALLER, not only the other windows", async () => {
    const h = harness();
    await fireCreateGrid(h, { id: "g-new", rows: 1, cols: 1, name: "" });
    const selfAck = h.toSelf.find(([ev]) => ev === "grid_created");
    expect(selfAck, "the creating client got no grid_created").toBeTruthy();
    expect(String(selfAck[1].grid.id)).toBe("g-new");
  });

  // The control: the broadcast half must still work, or "acked the caller"
  // could just mean the emit moved rather than that both happen.
  it("still broadcasts to the other windows", async () => {
    const h = harness();
    await fireCreateGrid(h, { id: "g-new", rows: 1, cols: 1, name: "" });
    expect(h.toOthers.find(([ev]) => ev === "grid_created")).toBeTruthy();
  });

  it("persists the grid it was asked for", async () => {
    const h = harness();
    await fireCreateGrid(h, { id: "g-new", rows: 1, cols: 1, name: "workshop" });
    expect(findOneAndUpdate).toHaveBeenCalled();
    const [query, doc] = findOneAndUpdate.mock.calls[0];
    expect(query).toMatchObject({ _id: "g-new", userId: "u1" });
    expect(doc).toMatchObject({ name: "workshop", rows: 1, cols: 1 });
  });
});
