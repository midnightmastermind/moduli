import { describe, it, expect } from "vitest";
import { modulesNeedingHabit } from "../migrations/0188-routines-are-habits-again.mjs";

const HABIT = "29L0qKNb5Ak_";
const world = () => {
  const occs = [
    { id: "layer", occurrences: ["slotA", "slotB"] },
    { id: "slotA", occurrences: ["drink"] },
    { id: "slotB", occurrences: ["hotTub"] },
    { id: "drink",  moduleId: "m-drink",  meta: {} },
    { id: "hotTub", moduleId: "m-hottub", meta: {} },
    // clones of the drink template row, each with their OWN module — the 0117 shape
    { id: "c1", moduleId: "m-c1", meta: { appliedFromTemplateId: "drink" } },
    { id: "c2", moduleId: "m-c2", meta: { appliedFromTemplateId: "drink" } },
    // a clone of the row that ALREADY binds it — must not be touched
    { id: "c3", moduleId: "m-c3", meta: { appliedFromTemplateId: "hotTub" } },
  ];
  const modById = new Map([
    ["m-drink",  { id: "m-drink",  fieldBindings: [] }],
    ["m-hottub", { id: "m-hottub", fieldBindings: [{ fieldId: HABIT, order: 91 }] }],
    ["m-c1", { id: "m-c1", fieldBindings: [] }],
    ["m-c2", { id: "m-c2", fieldBindings: [] }],
    ["m-c3", { id: "m-c3", fieldBindings: [{ fieldId: HABIT, order: 91 }] }],
  ]);
  return { layer: occs[0], occs, modById, habitId: HABIT };
};

describe("0188 — who needs the Habit marker", () => {
  it("finds the row whose module lacks it, and skips the one that has it", () => {
    const { rows } = modulesNeedingHabit(world());
    expect(rows.map((r) => r.id)).toEqual(["drink"]);
  });

  it("reaches EVERY CLONE, not just the template — the 0117 lesson", () => {
    // Binding only the template gives the field to future rows and leaves every row
    // already on a schedule without it.
    const { moduleIds } = modulesNeedingHabit(world());
    expect(moduleIds.sort()).toEqual(["m-c1", "m-c2", "m-drink"]);
  });

  it("never touches a module that already binds it — idempotent", () => {
    const w = world();
    w.modById.set("m-drink", { id: "m-drink", fieldBindings: [{ fieldId: HABIT }] });
    w.modById.set("m-c1", { id: "m-c1", fieldBindings: [{ fieldId: HABIT }] });
    w.modById.set("m-c2", { id: "m-c2", fieldBindings: [{ fieldId: HABIT }] });
    const { rows, moduleIds } = modulesNeedingHabit(w);
    expect(rows).toEqual([]);
    expect(moduleIds).toEqual([]);
  });

  it("derives the set from the LAYER, so a routine added later is covered by a re-run", () => {
    const w = world();
    w.occs.push({ id: "slotC", occurrences: ["newRoutine"] },
                 { id: "newRoutine", moduleId: "m-new", meta: {} });
    w.layer.occurrences = [...w.layer.occurrences, "slotC"];
    w.modById.set("m-new", { id: "m-new", fieldBindings: [] });
    expect(modulesNeedingHabit(w).moduleIds).toContain("m-new");
  });

  it("returns nothing for an empty layer rather than throwing", () => {
    expect(modulesNeedingHabit({ layer: { occurrences: [] }, occs: [], modById: new Map(), habitId: HABIT }))
      .toEqual({ rows: [], moduleIds: [] });
  });
});
