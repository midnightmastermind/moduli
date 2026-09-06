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
      modulesById: {}, viewsById: {}, foldersById: {}, manifestsById: {},
      fieldsById: {}, operationsById: {}, gridsById: {},
      // What `state.js` derives from the grid document at load, so the write
      // path never queries for it.
      filterFieldIds: new Set([DATE]),
      // What `state.js` derives from the stored PIPELINES: a field an operation
      // stamps from the destination container is per-placement too.
      placementFieldIds: new Set([SLOT]),
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

  it("CONTROL: the fan-out works at all — shared state reaches every member", () => {
    // Without this the test below cannot distinguish "the date is excluded"
    // from "nothing propagates", which would make the whole file vacuous.
    return fire("update_occurrence")({
      occurrence: { id: "todo-aug29", fields: { [DONE]: { value: true, flow: "replace" } } },
    }).then(() => {
      expect(val("todo-src", DONE)).toBe(true);
      expect(val("todo-aug26", DONE)).toBe(true);
    });
  });

  it("THE DEFECT: a Date written on one member overwrites every other member's", async () => {
    expect(val("todo-aug26", DATE)).toBe("2026-08-26");   // before: correct for its column
    await fire("update_occurrence")({
      occurrence: { id: "todo-aug29", fields: { [DATE]: { value: "2026-08-29", flow: "replace" } } },
    });
    // The Aug-26 copy now claims to be an Aug-29 row — the exact live shape.
    expect(val("todo-aug26", DATE)).toBe("2026-08-26");
  });

  it("THE RECURRENCE: the fan-out re-dates the copy-link SOURCE that 0145/0271 clear", async () => {
    await fire("update_occurrence")({
      occurrence: { id: "todo-aug29", fields: { [DATE]: { value: "2026-08-29", flow: "replace" } } },
    });
    // A dated source stamps every copy it ever mints — `dated-copy-link-source`.
    expect(val("todo-src", DATE)).toBe("2026-08-26");
  });

  it("a non-filter field on the same write still reaches everyone", async () => {
    // The fix must be narrow: only the fields the grid FILTERS on are
    // per-placement. Everything else is what the feature is for.
    await fire("update_occurrence")({
      occurrence: { id: "todo-aug29", fields: {
        [DATE]: { value: "2026-08-29", flow: "replace" },
        [DONE]: { value: true, flow: "replace" },
      } },
    });
    expect(val("todo-aug26", DONE)).toBe(true);
    expect(val("todo-aug26", DATE)).toBe("2026-08-26");
  });

  it("FAILS OPEN: with no known filter fields it behaves exactly as before", async () => {
    // The direction of the failure is a decision. A cache that has not been
    // populated yet must not silently stop a copy-link group sharing state —
    // that is a worse failure than the one being fixed, and it would be
    // invisible. So an unknown set propagates everything, as it always did.
    uc.filterFieldIds = undefined;
    await fire("update_occurrence")({
      occurrence: { id: "todo-aug29", fields: { [DATE]: { value: "2026-08-29", flow: "replace" } } },
    });
    expect(val("todo-aug26", DATE)).toBe("2026-08-29");
  });

  it("a write carrying ONLY filter fields propagates nothing rather than an empty patch", async () => {
    const before = { ...db.occurrences.get("todo-aug26").fields };
    await fire("update_occurrence")({
      occurrence: { id: "todo-aug29", fields: { [DATE]: { value: "2030-01-01", flow: "replace" } } },
    });
    expect(db.occurrences.get("todo-aug26").fields).toEqual(before);
    expect(val("todo-aug29", DATE)).toBe("2030-01-01");   // the sender still writes
  });


// ── The second kind of per-placement field (2026-09-06) ─────────────────────
//
// `Time Slot` decides which SLOT a row sits in — the filter fields' argument
// one level down — and it was still being shared. All eight members of the
// Todo group were nulled within five seconds at the day rollover, twice in one
// day, because one member's write reached the rest INCLUDING the master, whose
// value is its identity: `Schedule: Build Schedule` FINDs the Todo container BY
// `fields.<Time Slot>.value IS "Todo"`.

  it("does NOT fan a Time Slot write across the group", async () => {
    await handlers.get("update_occurrence")[0]({
      occurrence: { id: "todo-aug26", fields: { [SLOT]: { value: null, flow: "replace" } } },
    });
    // The master keeps its identity marker — the thing that was being erased.
    expect(uc.occurrencesById["todo-src"].fields[SLOT].value).toBe("Todo");
    expect(uc.occurrencesById["todo-aug29"].fields[SLOT].value).toBe("Todo");
  });

  it("still fans an ordinary field on the same write", async () => {
    // THE CONTROL. Without it, "Time Slot does not fan" is also satisfied by a
    // fan-out that has stopped working — which is the feature, not the fix.
    await handlers.get("update_occurrence")[0]({
      occurrence: { id: "todo-aug26", fields: {
        [SLOT]: { value: null, flow: "replace" },
        [DONE]: { value: true, flow: "replace" },
      }},
    });
    expect(uc.occurrencesById["todo-src"].fields[SLOT].value).toBe("Todo");
    expect(uc.occurrencesById["todo-src"].fields[DONE].value).toBe(true);
  });
});