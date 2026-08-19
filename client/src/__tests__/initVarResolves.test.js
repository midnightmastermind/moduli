// INIT_VAR resolves `value`, not just `expr` — the third case in this family.
//
// `SET_VAR` had it (fixed 2026-08-19, and it was why the day's schedule was
// empty) and `MULTIPLY_VAR`'s own comment records it a third time. Here it cost
// four failed attempts at `Fitness: Today's Prescription`: `value: "${$n}"`
// stored six literal characters, so the index test below it was false on every
// iteration and the op wrote nothing while reporting a clean run.
//
// The regression risk is the OPPOSITE direction — a plain string must survive
// untouched — so that is asserted first and in bulk.
import { describe, it, expect } from "vitest";
import { executeActionItem } from "../helpers/operationActions";

const run = (cfg, $vars = {}) => {
  executeActionItem(cfg.type, cfg, $vars, {
    state: {}, fieldsById: {}, occurrencesById: {}, operationsById: {}, modulesById: {},
  }, null);
  return $vars;
};

describe("INIT_VAR", () => {
  it("interpolates ${...} given as `value` — the prescription bug", () => {
    expect(run({ type: "INIT_VAR", name: "$x", value: "${$n}" }, { $n: 6 }).$x).toBe("6");
    expect(run({ type: "INIT_VAR", name: "$x", value: "${$a} — ${$b}" }, { $a: "Squats", $b: "done" }).$x)
      .toBe("Squats — done");
  });

  it("strips a literal: prefix given as `value`", () => {
    expect(run({ type: "INIT_VAR", name: "$x", value: "literal:" }).$x).toBe("");
    expect(run({ type: "INIT_VAR", name: "$x", value: "literal:not yet" }).$x).toBe("not yet");
  });

  // 28 of the 73 `value`-only steps on the live grid are plain strings. If any
  // of them changed, this fix would be a regression rather than a repair.
  it("leaves a plain string exactly as it is", () => {
    for (const v of ["day-col", "Day 1", "not yet", "Physical", "a.b.c", "2026-08-19"]) {
      expect(run({ type: "INIT_VAR", name: "$x", value: v }).$x).toBe(v);
    }
  });

  it("leaves numbers, booleans and objects alone", () => {
    expect(run({ type: "INIT_VAR", name: "$x", value: 0 }).$x).toBe(0);
    expect(run({ type: "INIT_VAR", name: "$x", value: 240 }).$x).toBe(240);
    const obj = { a: 1 };
    expect(run({ type: "INIT_VAR", name: "$x", value: obj }).$x).toEqual(obj);
  });

  it("still prefers `expr`, and still defaults to 0 with neither", () => {
    expect(run({ type: "INIT_VAR", name: "$x", expr: "$src" }, { $src: 42 }).$x).toBe(42);
    expect(run({ type: "INIT_VAR", name: "$x" }).$x).toBe(0);
  });
});
