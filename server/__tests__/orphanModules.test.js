import { describe, it, expect } from "vitest";
import { planOrphanModules, collectReferencedModuleIds, moduleAgeMinutes, MIN_AGE_MINUTES }
  from "../utils/orphanModules.js";

const NOW = Date.parse("2026-08-11T12:00:00Z");
const ago = (min) => new Date(NOW - min * 60000);
const mod = (id, over = {}) => ({ id, _id: id, role: "instance", label: id, createdAt: ago(600), ...over });
const occ = (id, moduleId) => ({ id, moduleId });
const run = (o) => planOrphanModules({ referencedIds: new Set(), now: NOW, ...o });

describe("planOrphanModules", () => {
  it("drops a module no occurrence places", () => {
    const { drop } = run({ modules: [mod("dead")], occurrences: [] });
    expect(drop.map(m => m.id)).toEqual(["dead"]);
  });

  it("never touches a module that IS placed", () => {
    const { drop, keep } = run({ modules: [mod("live")], occurrences: [occ("o1", "live")] });
    expect(drop).toEqual([]);
    expect(keep).toEqual([]);        // placed modules are not even a decision
  });

  it("KEEPS a template root — having no placement is its normal state", () => {
    // A template exists to be cloned FROM. Sweeping it would delete the thing
    // every future apply reads.
    const { drop, keep } = run({
      modules: [mod("tpl", { meta: { templateModule: true } })], occurrences: [],
    });
    expect(drop).toEqual([]);
    expect(keep[0].why).toContain("is a template root");
  });

  it("KEEPS a module an operation still names", () => {
    const { drop, keep } = run({
      modules: [mod("byOp")], occurrences: [], referencedIds: new Set(["byOp"]),
    });
    expect(drop).toEqual([]);
    expect(keep[0].why[0]).toMatch(/operation or textmap/);
  });

  it("KEEPS a module younger than the age floor — its placement may be in flight", () => {
    // create_module and create_occurrence are separate writes and the
    // occurrence create is queued server-side; sweeping the gap deletes a
    // module whose placement is still coming.
    const { drop, keep } = run({ modules: [mod("fresh", { createdAt: ago(5) })], occurrences: [] });
    expect(drop).toEqual([]);
    expect(keep[0].why[0]).toMatch(/in flight/);
  });

  it("drops it once it is past the floor — the floor is a delay, not a reprieve", () => {
    const { drop } = run({
      modules: [mod("aged", { createdAt: ago(MIN_AGE_MINUTES + 1) })], occurrences: [],
    });
    expect(drop.map(m => m.id)).toEqual(["aged"]);
  });

  it("reports EVERY reason, so a keep is explainable", () => {
    const { keep } = run({
      modules: [mod("all3", { meta: { templateModule: true }, createdAt: ago(1) })],
      occurrences: [], referencedIds: new Set(["all3"]),
    });
    expect(keep[0].why).toHaveLength(3);
  });

  it("an unknown creation time is NOT treated as young", () => {
    // Infinity, not 0 — a module with no timestamp must not be shielded forever.
    expect(moduleAgeMinutes({ id: "x" }, NOW)).toBe(Infinity);
    const { drop } = run({ modules: [{ id: "x", _id: "x" }], occurrences: [] });
    expect(drop.map(m => m.id)).toEqual(["x"]);
  });
});

describe("collectReferencedModuleIds", () => {
  it("finds an id nested anywhere in a document", () => {
    const docs = [{ pipeline: { steps: [{ config: { templateId: "m-42" } }] } }];
    expect([...collectReferencedModuleIds(docs, new Set(["m-42", "m-99"]))]).toEqual(["m-42"]);
  });

  it("returns nothing when there are no candidates — never scans for free", () => {
    expect(collectReferencedModuleIds([{ a: 1 }], new Set()).size).toBe(0);
  });

  it("survives a document that cannot be serialised", () => {
    const cyclic = {}; cyclic.self = cyclic;
    expect(() => collectReferencedModuleIds([cyclic, { x: "m-1" }], new Set(["m-1"]))).not.toThrow();
    expect(collectReferencedModuleIds([cyclic, { x: "m-1" }], new Set(["m-1"])).has("m-1")).toBe(true);
  });
});
