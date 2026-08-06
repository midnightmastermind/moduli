// Picking an occurrence in a dropdown fills the fields that pick implies.
// This is the pure decision half — no React, no writes.
//
// Policy, settled with the user 2026-08-06:
//   - a pick ALWAYS overwrites (you may hand-correct; re-picking replaces it)
//   - only fields the TARGET MODULE already binds are filled
//   - no marker is stored on a filled value: it is an ordinary value
import { describe, it, expect } from "vitest";
import { planPrefill, COMBINERS } from "../helpers/prefillFromPick";

// ── a small world: two ingredients, a meal that names them ──────────────────
const F = {
  protein: "f-protein",
  calories: "f-calories",
  ingredients: "f-ingredients",   // occurrence field, multi
  meal: "f-meal",                 // occurrence field, single
  note: "f-note",
};

const fieldsById = {
  [F.protein]: { id: F.protein, name: "Protein", type: "number" },
  [F.calories]: { id: F.calories, name: "Calories", type: "number" },
  [F.note]: { id: F.note, name: "Note", type: "text" },
  [F.ingredients]: {
    id: F.ingredients, name: "Ingredients", type: "occurrence",
    meta: {
      multiSelect: true,
      // Filling the macros from the picked ingredients is the SAME config that
      // serves a direct ingredient pick — which is what makes chaining free.
      prefill: {
        enabled: true,
        map: [
          { from: F.protein, combine: "sum" },
          { from: F.calories, combine: "sum" },
        ],
      },
    },
  },
  [F.meal]: {
    id: F.meal, name: "Meal", type: "occurrence",
    meta: {
      prefill: {
        enabled: true,
        chain: 1,
        map: [{ from: F.ingredients, combine: "union" }],
      },
    },
  },
};

const mod = (id, fieldIds) => ({ id, fieldBindings: fieldIds.map(fid => ({ fieldId: fid, role: "input" })) });
const modulesById = {
  "m-ingredient": mod("m-ingredient", [F.protein, F.calories]),
  "m-meal": mod("m-meal", [F.ingredients]),
  // The thing being edited: an Eat action that carries macros AND an ingredients pick.
  "m-eat": mod("m-eat", [F.ingredients, F.meal, F.protein, F.calories]),
  // A target that does NOT carry Calories.
  "m-snack": mod("m-snack", [F.ingredients, F.protein]),
};

const occ = (id, moduleId, fields) => ({ id, moduleId, fields });
const occurrencesById = {
  chicken: occ("chicken", "m-ingredient", { [F.protein]: { value: 24, flow: "in" }, [F.calories]: { value: 165, flow: "in" } }),
  rice:    occ("rice",    "m-ingredient", { [F.protein]: { value: 4, flow: "in" }, [F.calories]: { value: 206, flow: "in" } }),
  water:   occ("water",   "m-ingredient", {}),                                   // no macros at all
  oddball: occ("oddball", "m-ingredient", { [F.protein]: { value: "some", flow: "in" } }), // non-numeric
  burrito: occ("burrito", "m-meal", { [F.ingredients]: { value: ["chicken", "rice"], flow: "in" } }),
  eat:     occ("eat",     "m-eat", {}),
  snack:   occ("snack",   "m-snack", {}),
};

const ctx = { occurrencesById, modulesById, fieldsById };
const plan = (fieldId, value, targetId = "eat") =>
  planPrefill({ field: fieldsById[fieldId], value, target: occurrencesById[targetId], ctx });
const byId = (writes) => Object.fromEntries(writes.map(w => [w.fieldId, w.value]));

describe("planPrefill — one hop", () => {
  it("a single pick fills the mapped fields", () => {
    const { writes } = plan(F.ingredients, ["chicken"]);
    expect(byId(writes)).toEqual({ [F.protein]: 24, [F.calories]: 165 });
  });

  it("`to` defaults to `from` — the same field on both sides is the common case", () => {
    const { writes } = plan(F.ingredients, ["chicken"]);
    expect(writes.every(w => w.fieldId === w.sources.from)).toBe(true);
  });

  it("SUM across several picks — the user's 'add up the nutrition of each ingredient'", () => {
    const { writes } = plan(F.ingredients, ["chicken", "rice"]);
    expect(byId(writes)).toEqual({ [F.protein]: 28, [F.calories]: 371 });
  });

  it("a non-numeric contributor is SKIPPED, not coerced to zero", () => {
    const { writes } = plan(F.ingredients, ["chicken", "oddball"]);
    // 24 + (skip "some") = 24, and the count reflects only real contributors.
    expect(byId(writes)[F.protein]).toBe(24);
    expect(writes.find(w => w.fieldId === F.protein).sources.from).toBe(F.protein);
  });

  it("a pick carrying nothing writes nothing — never overwrite with empty", () => {
    expect(plan(F.ingredients, ["water"]).writes).toEqual([]);
  });

  it("an empty pick clears nothing", () => {
    expect(plan(F.ingredients, []).writes).toEqual([]);
    expect(plan(F.ingredients, null).writes).toEqual([]);
  });

  it("a single (non-array) pick works — single-select dropdowns", () => {
    const { writes } = plan(F.ingredients, "rice");
    expect(byId(writes)).toEqual({ [F.protein]: 4, [F.calories]: 206 });
  });
});

describe("planPrefill — the settled policy", () => {
  it("OVERWRITES a value the user already typed (user: 'it will be overwritten if i make the selection again')", () => {
    const edited = { ...occurrencesById.eat, fields: { [F.protein]: { value: 99, flow: "in" } } };
    const { writes } = planPrefill({ field: fieldsById[F.ingredients], value: ["chicken"], target: edited, ctx });
    expect(byId(writes)[F.protein]).toBe(24);
  });

  it("skips a field the TARGET MODULE does not bind — prefill never adds a field", () => {
    // m-snack carries Protein but not Calories.
    const { writes } = plan(F.ingredients, ["chicken", "rice"], "snack");
    expect(byId(writes)).toEqual({ [F.protein]: 28 });
  });

  it("stores no provenance on the value — a filled value is an ordinary value", () => {
    const { writes } = plan(F.ingredients, ["chicken"]);
    for (const w of writes) {
      expect(Object.keys(w)).toEqual(expect.arrayContaining(["fieldId", "value", "flow"]));
      expect(w).not.toHaveProperty("prefilledFrom");
    }
  });

  it("disabled config produces nothing", () => {
    const off = { ...fieldsById[F.ingredients], meta: { ...fieldsById[F.ingredients].meta, prefill: { ...fieldsById[F.ingredients].meta.prefill, enabled: false } } };
    expect(planPrefill({ field: off, value: ["chicken"], target: occurrencesById.eat, ctx }).writes).toEqual([]);
  });

  it("a field with no prefill config at all produces nothing", () => {
    expect(planPrefill({ field: fieldsById[F.protein], value: 5, target: occurrencesById.eat, ctx }).writes).toEqual([]);
  });
});

describe("planPrefill — chaining", () => {
  it("Meal fills the Ingredients dropdown AND the macros those ingredients imply", () => {
    const { writes } = plan(F.meal, "burrito");
    const got = byId(writes);
    expect(got[F.ingredients]).toEqual(["chicken", "rice"]); // union, from the meal
    expect(got[F.protein]).toBe(28);                          // summed one hop further
    expect(got[F.calories]).toBe(371);
  });

  it("chain: 0 stops after the direct fills", () => {
    const noChain = { ...fieldsById[F.meal], meta: { ...fieldsById[F.meal].meta, prefill: { ...fieldsById[F.meal].meta.prefill, chain: 0 } } };
    const { writes } = planPrefill({ field: noChain, value: "burrito", target: occurrencesById.eat, ctx });
    expect(byId(writes)).toEqual({ [F.ingredients]: ["chicken", "rice"] });
  });

  it("a field is never written twice — first write wins", () => {
    const { writes } = plan(F.meal, "burrito");
    const ids = writes.map(w => w.fieldId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("a cycle terminates", () => {
    // A points at B, B points back at A.
    const a = { id: "f-a", name: "A", type: "occurrence", meta: { prefill: { enabled: true, chain: 9, map: [{ from: "f-b" }] } } };
    const b = { id: "f-b", name: "B", type: "occurrence", meta: { prefill: { enabled: true, chain: 9, map: [{ from: "f-a" }] } } };
    const cyc = {
      occurrencesById: { x: occ("x", "m-x", { "f-a": { value: ["y"] }, "f-b": { value: ["x"] } }), y: occ("y", "m-x", { "f-a": { value: ["x"] }, "f-b": { value: ["y"] } }), t: occ("t", "m-t", {}) },
      modulesById: { "m-x": mod("m-x", ["f-a", "f-b"]), "m-t": mod("m-t", ["f-a", "f-b"]) },
      fieldsById: { "f-a": a, "f-b": b },
    };
    expect(() => planPrefill({ field: a, value: ["x"], target: cyc.occurrencesById.t, ctx: cyc })).not.toThrow();
  });
});

describe("COMBINERS", () => {
  it("sum / avg / min / max ignore non-numerics", () => {
    expect(COMBINERS.sum([1, 2, "x", 3])).toBe(6);
    expect(COMBINERS.avg([2, 4, "x"])).toBe(3);
    expect(COMBINERS.min([5, 2, "x"])).toBe(2);
    expect(COMBINERS.max([5, 2, "x"])).toBe(5);
  });
  it("avg of nothing numeric is undefined, not NaN", () => {
    expect(COMBINERS.avg(["x", "y"])).toBeUndefined();
    expect(COMBINERS.sum(["x"])).toBeUndefined();
  });
  it("union flattens and de-duplicates, preserving order", () => {
    expect(COMBINERS.union([["a", "b"], ["b", "c"]])).toEqual(["a", "b", "c"]);
  });
  it("concat joins text", () => {
    expect(COMBINERS.concat(["a", "b"])).toBe("a, b");
  });
  it("replace takes the first pick — deterministic for a single-select", () => {
    expect(COMBINERS.replace([7, 9])).toBe(7);
  });
});
