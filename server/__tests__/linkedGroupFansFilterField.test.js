// A COPY-LINK GROUP SHARES ITS DATE, AND THE DATE IS WHAT SAYS WHICH DAY IT IS ON.
//
// `gridIntegrity`'s `dated-copy-link-source` rule fired on poms grid again on
// 2026-08-29 — the SAME Todo container (`LnLC5V1KIMt_`) that migration `0271`
// cleared on 08-28, re-stamped with today's date at 08:14. Read out of Mongo:
//
//   linked group lg-LnLC5V1KIMt_   8 members (source + 7 copies)
//   distinct Date values           1  -> "2026-08-29"
//   one member's parent            "Wednesday, August 26th, 2026"
//
// That last line is the finding. A copy sitting in the AUG 26 day column
// carries AUG 29. No per-column stamp can produce that; a fan-out across the
// linked group can, and does — `update_occurrence` propagates EVERY field in
// the payload to every other member of the group (socketHandlers/occurrences.js).
//
// The other control: of the "Day" template's 49 children, exactly ONE carries a
// Date — the Todo, which is the only one in a linked group. So this is not
// APPLY_TEMPLATE stamping the template, which was the first suspicion.
//
// WHY IT MATTERS: the grid FILTERS on Date. A value shared across placements
// means every copy is visible on exactly one day and hidden on the others —
// which is the 2026-08-28 report ("the user's Todo list was hidden on every day
// but Aug 18") and why `0145`/`0271` keep having to clear it. Clearing the data
// cannot hold: the next day's stamp fans straight back in.
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = { occurrences: new Map(), modules: new Map() };
const delayed = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
const applyUpdate = (store, filter, update) => {
  const patch = update?.$set ?? update;
  const next = { ...(store.get(filter.id) || { id: filter.id }), ...patch };
  store.set(filter.id, next);
  return next;
};

vi.mock("../models/Occurrence.js", () => ({
  default: {
    findOne: vi.fn(({ id }) => ({ lean: () => delayed(1, db.occurrences.get(id) || null) })),
    find: vi.fn(() => { const q = { setOptions: () => q, select: () => q, lean: async () => [] }; return q; }),
    findOneAndUpdate: vi.fn(async (f, u) => { await delayed(1); return applyUpdate(db.occurrences, f, u); }),
    findOneAndDelete: vi.fn(async ({ id }) => { db.occurrences.delete(id); return null; }),
    bulkWrite: vi.fn(async () => ({ ok: 1 })),
  },
}));
vi.mock("../models/Module.js", () => ({ default: { findOneAndUpdate: vi.fn(async (f, u) => applyUpdate(db.modules, f, u)) } }));
vi.mock("../models/Grid.js", () => ({ default: { findOne: vi.fn(() => ({ lean: () => delayed(1, null) })), findOneAndUpdate: vi.fn(() => delayed(1, null)) } }));
vi.mock("../models/View.js", () => ({ default: {} }));
vi.mock("../models/Folder.js", () => ({ default: {} }));
vi.mock("../models/Manifest.js", () => ({ default: {} }));
vi.mock("../models/Field.js", () => ({ default: {} }));
vi.mock("../models/Operation.js", () => ({ default: {} }));
vi.mock("../models/Transaction.js", () => ({ default: class { constructor(d) { Object.assign(this, d); } async save() {} toJSON() { return { ...this }; } } }));
vi.mock("../services/thumbnailService.js", () => ({ invalidateThumbnail: vi.fn() }));
vi.mock("../utils/txRecorder.js", () => ({ recordDoc: vi.fn(), flushAction: vi.fn(), flushAll: vi.fn(), closeAction: vi.fn() }));

const { registerCrudHandlers } = await import("../socketHandlers/crud.js");
const { registerOccurrenceHandlers } = await import("../socketHandlers/occurrences.js");

const DATE = "Eh7oi4HKdbHB";      // poms grid's one filter field
const DONE = "tZWiPDQUDP74";      // "Completed" — shared state, SHOULD fan out
const SLOT = "field-time-slot";   // stamped from the destination — per-placement

describe("update_occurrence fan-out across a copy-link group", () => {
  let handlers, uc, socket;
  const fire = (e) => (...a) => Promise.all((handlers.get(e) || []).map(fn => fn(...a)));
  const val = (id, f) => db.occurrences.get(id)?.fields?.[f]?.value;

  beforeEach(() => {
    db.occurrences.clear(); db.modules.clear();
    handlers = new Map();

    // The live shape: one linked group whose members sit in DIFFERENT day
    // columns, so their dates legitimately differ.
    const mk = (id, date) => ({
      _id: id, id, userId: "u1", gridId: "g1", moduleId: "mod-todo",
      linkedGroupId: "lg-todo", occurrences: [],
      fields: { [DATE]: { value: date, flow: "replace" },
                [SLOT]: { value: "Todo", flow: "replace" } },
    });
    for (const [id, d] of [["todo-src", "2026-08-26"], ["todo-aug26", "2026-08-26"], ["todo-aug29", "2026-08-29"]]) {
      db.occurrences.set(id, mk(id, d));
    }
    uc = {
      occurrencesById: Object.fromEntries([...db.occurrences].map(([k, v]) => [k, { ...v }])),
      modulesById: { "mod-todo": { id: "mod-todo", role: "container" } }, viewsById: {}, foldersById: {}, manifestsById: {},
      fieldsById: {}, operationsById: {}, gridsById: {},
      // What `state.js` derives from the grid document at load, so the write
      // path never queries for it.

      // What `state.js` derives from the stored PIPELINES: a field an operation
      // stamps from the destination container is per-placement too.

    };
    socket = {
      id: "s1", userId: "u1", data: { activeGridId: "g1" },
      on: (e, fn) => handlers.set(e, [...(handlers.get(e) || []), fn]),
      emit: vi.fn(), to: () => ({ emit: vi.fn() }),
    };
    const deps = {
      ensureUserCache: () => uc, userCacheReady: () => true, loadUserIntoCache: vi.fn(),
      getAllGridsForUser: vi.fn(async () => []), userRoom: (u) => `user:${u}`, gridRoom: (g) => `grid:${g}`,
      getOccurrencesForGrid: vi.fn(() => []), createOccurrenceData: vi.fn((o) => o),
    };
    registerCrudHandlers(socket, deps);
    registerOccurrenceHandlers(socket, { io: { to: () => ({ emit: () => {} }), sockets: { adapter: { rooms: new Map() } } }, ...deps });
  });

  // A COPY-LINK GROUP SHARES EVERY FIELD AND VALUE (user, 2026-10-27): "copylink
  // should always share the same fields and values". Until then Date and Time
  // Slot were held back because Schedule slot / Todo copies carried a Date; those
  // dates are cleared (0429) and a slot's day comes from its day column.
  it("shares an ordinary field with every member", async () => {
    await fire("update_occurrence")({
      occurrence: { id: "todo-aug29", fields: { [DONE]: { value: true, flow: "replace" } } },
    });
    expect(val("todo-src", DONE)).toBe(true);
    expect(val("todo-aug26", DONE)).toBe(true);
  });

  it("shares the Date and the Time Slot too", async () => {
    await fire("update_occurrence")({
      occurrence: { id: "todo-aug29", fields: {
        [DATE]: { value: "2026-11-02", flow: "replace" },
        [SLOT]: { value: "3:00pm", flow: "replace" },
      } },
    });
    expect(val("todo-src", DATE)).toBe("2026-11-02");
    expect(val("todo-aug26", DATE)).toBe("2026-11-02");
    expect(val("todo-aug26", SLOT)).toBe("3:00pm");
  });

  it("an unlinked row is not touched", async () => {
    db.occurrences.set("other", { id: "other", userId: "u1", gridId: "g1", fields: {} });
    uc.occurrencesById.other = { id: "other", userId: "u1", gridId: "g1", fields: {} };
    await fire("update_occurrence")({
      occurrence: { id: "todo-aug29", fields: { [DATE]: { value: "2026-11-02", flow: "replace" } } },
    });
    expect(val("other", DATE)).toBeUndefined();
  });
});
