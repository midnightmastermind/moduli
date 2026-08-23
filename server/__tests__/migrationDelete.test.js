// A migration that deletes an occurrence must take its module with it.
//
// The runtime path has done this since 2026-08-19; migrations write straight to
// Mongo and skip that handler entirely, which is why 31 occurrence-deleting
// migrations stranded modules — 56 `Eat` husks from `0108` alone.
import { describe, it, expect } from "vitest";
import { modulesStrandedBy } from "../utils/migrationDelete.js";

const M = (id, extra = {}) => ({ id, label: id, ...extra });
const O = (id, moduleId) => ({ id, moduleId });

describe("modulesStrandedBy", () => {
  it("returns the module whose only placement is being deleted", () => {
    const { drop } = modulesStrandedBy({
      deletedOccIds: ["o1"], remainingOccurrences: [O("o1", "m1")], modules: [M("m1")] });
    expect(drop.map(m => m.id)).toEqual(["m1"]);
  });

  it("KEEPS a module that still has another placement — the control", () => {
    // Without this, a helper that returned every candidate would pass the test
    // above and delete a template something still renders.
    const { drop } = modulesStrandedBy({
      deletedOccIds: ["o1"], remainingOccurrences: [O("o1", "m1"), O("o2", "m1")], modules: [M("m1")] });
    expect(drop).toEqual([]);
  });

  it("KEEPS a module an operation or textmap references", () => {
    const { drop, keep } = modulesStrandedBy({
      deletedOccIds: ["o1"], remainingOccurrences: [O("o1", "m1")], modules: [M("m1")],
      referencedIds: new Set(["m1"]) });
    expect(drop).toEqual([]);
    expect(keep[0].why.join()).toMatch(/referenced/);
  });

  it("KEEPS a template root — no placement is its normal state", () => {
    const { drop } = modulesStrandedBy({
      deletedOccIds: ["o1"], remainingOccurrences: [O("o1", "m1")],
      modules: [M("m1", { meta: { templateModule: true } })] });
    expect(drop).toEqual([]);
  });

  it("ignores the age floor — inside a migration the placement demonstrably existed", () => {
    // The sweeper's 60-minute floor guards a module whose FIRST placement may
    // still be in flight. A migration is synchronous and the row was there a
    // moment ago, so a freshly minted module is still fair game.
    const { drop } = modulesStrandedBy({
      deletedOccIds: ["o1"], remainingOccurrences: [O("o1", "m1")],
      modules: [M("m1", { createdAt: new Date().toISOString() })] });
    expect(drop.map(m => m.id)).toEqual(["m1"]);
  });

  it("does not consider modules this delete never touched", () => {
    // Scope is the difference between a migration and a full sweep: unrelated
    // debris is `sweepOrphans`' business, with a human running it.
    const { drop } = modulesStrandedBy({
      deletedOccIds: ["o1"], remainingOccurrences: [O("o1", "m1")], modules: [M("m1"), M("unrelated")] });
    expect(drop.map(m => m.id)).toEqual(["m1"]);
  });
});
