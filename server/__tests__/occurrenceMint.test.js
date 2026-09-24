// server/__tests__/occurrenceMint.test.js
//
// ONE WAY TO MINT. The ingest route and the executor's CREATE must not grow
// two copies of "find-or-create a module, then mint an occurrence under a
// parent" — this repo's most-repeated defect class.
import { describe, it, expect, vi, beforeEach } from "vitest";

// Minimal filter/update support shared by updateOne/findOneAndUpdate below —
// NOT in the task brief's original draft. Review round 1 (CRITICAL 1) requires
// mintOccurrence's STANDALONE parent-link fallback (used when no `linkToParent`
// callback is injected) to be genuinely atomic — the same `$push` guarded by
// `occurrences: { $ne: childId } }` that `linkIntoParent` in apiV1.js already
// uses at 8 call sites. `/ingest` always injects `linkToParent`, so this
// fallback (and hence `Occurrence.updateOne`) is never exercised by
// apiIngest.test.js — it is exercised ONLY by this file's own tests 1-3, which
// call mintOccurrence with no `linkToParent`. Extending THIS mock (which this
// task authors) is how that got satisfied without touching the protected
// apiIngest.test.js regression guard at all.
function matchesOccFilter(doc, filter = {}) {
  for (const [k, v] of Object.entries(filter)) {
    if (k === "occurrences") {
      const list = doc.occurrences || [];
      if (v && typeof v === "object" && "$ne" in v) {
        if (list.includes(v.$ne)) return false;
      } else if (!list.includes(v)) return false;
      continue;
    }
    if (doc[k] !== v) return false;
  }
  return true;
}
function applyOccUpdate(doc, update) {
  if (update.$set) Object.assign(doc, update.$set);
  if (update.$push) {
    const spec = update.$push.occurrences;
    const list = [...(doc.occurrences || [])];
    if (spec && typeof spec === "object" && "$each" in spec) {
      const pos = spec.$position;
      if (Number.isInteger(pos)) list.splice(pos, 0, ...spec.$each);
      else list.push(...spec.$each);
    } else {
      list.push(spec);
    }
    doc.occurrences = list;
  }
}

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
    if (!o || !matchesOccFilter(o, q)) return { matchedCount: 0, modifiedCount: 0 };
    applyOccUpdate(o, u);
    return { matchedCount: 1, modifiedCount: 1 };
  },
  // NOT in the task brief's original draft: `mintOccurrence` (see its own
  // header) uses `findOneAndUpdate` rather than `updateOne` for the
  // existing-occurrence UPDATE path, so the SAME implementation also
  // satisfies `apiIngest.test.js`'s existing model mock, which has
  // `findOneAndUpdate` but no `updateOne`. Added here rather than touching
  // that regression-guard file.
  findOneAndUpdate: async (q, u) => {
    const o = [...occurrences.values()].find(x => x.id === q.id);
    if (!o || !matchesOccFilter(o, q)) return null;
    applyOccUpdate(o, u);
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

// A FOLDER parent (the share catch-all → Files). The row names the folder in
// parentId and NOTHING is pushed — a folder has no occurrences[].
describe("mintOccurrence — folder parent", () => {
  it("places the row in the folder without touching any occurrence's list", async () => {
    const { mintOccurrence } = await import("../services/occurrenceMint.js");
    const r = await mintOccurrence({
      userId: "u1", gridId: "g1", label: "a link", parentFolderId: "files-folder-g1",
      externalId: "link:https://x.test/folder",
    });
    expect(r.status).toBe("created");
    expect(r.linked).toBe(false);
    const Occurrence = (await import("../models/Occurrence.js")).default;
    const row = await Occurrence.findOne({ id: r.occurrenceId });
    expect(row.parentId).toBe("files-folder-g1");
  });

  it("refuses both parent kinds at once", async () => {
    const { mintOccurrence } = await import("../services/occurrenceMint.js");
    await expect(mintOccurrence({
      userId: "u1", gridId: "g1", label: "x", parentId: "p", parentFolderId: "f",
      externalId: "link:https://x.test/both",
    })).rejects.toThrow(/mutually exclusive/);
  });
});
