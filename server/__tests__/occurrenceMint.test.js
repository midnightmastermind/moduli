// server/__tests__/occurrenceMint.test.js
//
// ONE WAY TO MINT. The ingest route and the executor's CREATE must not grow
// two copies of "find-or-create a module, then mint an occurrence under a
// parent" — this repo's most-repeated defect class.
import { describe, it, expect, vi, beforeEach } from "vitest";

const modules = new Map(), occurrences = new Map();
vi.mock("../models/Module.js", () => ({ default: {
  findOne: async (q) => [...modules.values()].find(m => m.id === q.id) || null,
  create:  async (d) => { modules.set(d.id, { ...d }); return { ...d }; },
}}));
vi.mock("../models/Occurrence.js", () => ({ default: {
  findOne: async (q) => [...occurrences.values()].find(o =>
    (q.id && o.id === q.id) ||
    (q["meta.externalId"] && o.meta?.externalId === q["meta.externalId"])) || null,
  exists:  async (q) => !![...occurrences.values()].find(o => o.id === q.id),
  create:  async (d) => { occurrences.set(d.id, { ...d }); return { ...d }; },
  updateOne: async (q, u) => {
    const o = [...occurrences.values()].find(x => x.id === q.id);
    Object.assign(o, u.$set || {});
    return { modifiedCount: 1 };
  },
  // NOT in the task brief's original draft: `mintOccurrence` (see its own
  // header) uses `findOneAndUpdate` rather than `updateOne` so the SAME
  // implementation also satisfies `apiIngest.test.js`'s existing model mock,
  // which has `findOneAndUpdate` but no `updateOne`. Added here rather than
  // touching that regression-guard file. `updateOne` above is kept as given
  // and is simply unused by the current implementation.
  findOneAndUpdate: async (q, u) => {
    const o = [...occurrences.values()].find(x => x.id === q.id);
    if (!o) return null;
    if (u.$set) Object.assign(o, u.$set);
    return { ...o };
  },
}}));

const { mintOccurrence } = await import("../services/occurrenceMint.js");

beforeEach(() => {
  modules.clear(); occurrences.clear();
  occurrences.set("parent", { id: "parent", userId: "u1", occurrences: [], meta: {} });
});

describe("mintOccurrence", () => {
  it("BINDS the fields it writes, not just their values", async () => {
    // D17: ops gate on _boundFieldIds. A value on an unbound field renders
    // nowhere and is invisible to the Schedule.
    const res = await mintOccurrence({
      userId: "u1", gridId: "g1", label: "Dentist", parentId: "parent",
      moduleRole: "instance", moduleKind: "list",
      fields: { fDate: { value: "2026-09-25", flow: "in" } },
      fieldBindings: [{ fieldId: "fDate", role: "input", order: 0 }],
      externalId: "ics:abc", source: "share",
    });
    expect(res.status).toBe("created");
    const mod = modules.get(res.moduleId);
    expect(mod.fieldBindings).toEqual([{ fieldId: "fDate", role: "input", order: 0 }]);
  });

  it("lists the new occurrence in its parent", async () => {
    const res = await mintOccurrence({
      userId: "u1", gridId: "g1", label: "x", parentId: "parent",
      moduleRole: "instance", externalId: "e1", source: "share",
    });
    expect(occurrences.get("parent").occurrences).toContain(res.occurrenceId);
  });

  it("is idempotent on externalId — the same share twice updates one row", async () => {
    const a = await mintOccurrence({ userId: "u1", gridId: "g1", label: "v1",
      parentId: "parent", moduleRole: "instance", externalId: "e1", source: "share" });
    const b = await mintOccurrence({ userId: "u1", gridId: "g1", label: "v2",
      parentId: "parent", moduleRole: "instance", externalId: "e1", source: "share" });
    expect(b.occurrenceId).toBe(a.occurrenceId);
    expect(b.status).toBe("updated");
    expect(occurrences.get("parent").occurrences.filter(x => x === a.occurrenceId)).toHaveLength(1);
  });

  it("refuses a parentId that does not exist rather than orphaning the row", async () => {
    await expect(mintOccurrence({ userId: "u1", gridId: "g1", label: "x",
      parentId: "nope", moduleRole: "instance", externalId: "e2", source: "share" }))
      .rejects.toThrow(/parent/i);
  });
});
