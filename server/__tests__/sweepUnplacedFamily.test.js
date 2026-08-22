// `planSweep` — the predicate behind 0193, which DELETES. Every clause is a
// refusal, and each refusal has its own test, because the cost of a wrong sweep
// is a surface the user can see disappearing.
//
// `Total Reps` looked like the 0184 class — bound by 7 tiles, written by nobody,
// i.e. 7 empty pills. Measuring the binders changed the answer: all 7 have ZERO
// occurrences, so nothing renders at all. The "every binder is unplaced" clause
// is what separates "leftovers" from "a broken feature the user is looking at".
import { describe, it, expect } from "vitest";
import { planSweep, isWrittenByAnyOp } from "../migrations/0193-sweep-the-unplaced-volume-family.mjs";

const F = (id, extra = {}) => ({ id, name: id, displayEnabled: true, ...extra });
const M = (id, fieldIds) => ({ id, label: id, fieldBindings: fieldIds.map((f) => ({ fieldId: f })) });
const base = () => ({
  fields: [F("dead")],
  mods: [M("tileA", ["dead"]), M("tileB", ["dead"])],
  occs: [],          // neither tile is placed anywhere
  ops: [],
});

describe("planSweep", () => {
  it("sweeps a display field nothing writes whose every binder is unplaced", () => {
    const p = planSweep(base());
    expect(p.fields.map((f) => f.id)).toEqual(["dead"]);
    // REPORTED, not deleted — see the next test for why.
    expect(p.stranded.map((m) => m.id).sort()).toEqual(["tileA", "tileB"]);
  });

  it("REFUSES when even one binder is placed", () => {
    const w = base();
    w.occs = [{ id: "o1", moduleId: "tileB", fields: {} }];
    const p = planSweep(w);
    expect(p.fields).toEqual([]);
    expect(p.stranded).toEqual([]);
    expect(p.refused[0].why).toMatch(/binder\(s\) ARE placed/);
  });

  it("REFUSES when an occurrence still carries a value", () => {
    const w = base();
    w.occs = [{ id: "o1", moduleId: "other", fields: { dead: { value: 3 } } }];
    const p = planSweep(w);
    expect(p.fields).toEqual([]);
    expect(p.refused[0].why).toMatch(/carries a value/);
  });

  it("REFUSES a field an operation writes", () => {
    const w = base();
    w.ops = [{ name: "W", pipeline: { steps: [{ config: { type: "UPDATE", path: "$t.fields.dead.value" } }] } }];
    expect(planSweep(w).fields).toEqual([]);
  });

  it("...including one written only via targetFieldId — the form the first audit missed", () => {
    const w = base();
    w.ops = [{ name: "W", pipeline: { steps: [{ config: { type: "DATE_DIFF", targetFieldId: "dead" } }] } }];
    expect(planSweep(w).fields).toEqual([]);
  });

  it("leaves an UNBOUND field alone — that is a separate decision, not this sweep", () => {
    const w = base(); w.mods = [];
    expect(planSweep(w).fields).toEqual([]);
  });

  it("leaves a NON-display field alone", () => {
    const w = base(); w.fields = [F("dead", { displayEnabled: false })];
    expect(planSweep(w).fields).toEqual([]);
  });

  it("a module that also binds a SURVIVING field is still only reported, never deleted", () => {
    // The first draft deleted binder modules, guarded by "every field it binds
    // is also being swept". On the live grid that DECLINED all seven — they
    // bind `Category` and `Tracker Date`, which survive because OTHER tiles use
    // them. Shared fields make that clause false for nearly any tile, so it
    // could almost never delete anything: the guard was right to fire and was
    // also the wrong question. `sweepOrphans` asks the right one (placed?
    // referenced?) with an age floor this does not have.
    const w = base();
    w.fields.push(F("alive"));
    w.ops = [{ name: "W", pipeline: { steps: [{ config: { type: "UPDATE", path: "$t.fields.alive.value" } }] } }];
    w.mods = [M("tileA", ["dead"]), M("tileB", ["dead", "alive"])];
    const p = planSweep(w);
    expect(p.fields.map((f) => f.id)).toEqual(["dead"]);
    expect(p.stranded.map((m) => m.id).sort()).toEqual(["tileA", "tileB"]);
    expect(p).not.toHaveProperty("modules");
  });

  it("a PLACED binder keeps its field AND is not reported as stranded", () => {
    const w = base();
    w.occs = [{ id: "o1", moduleId: "tileA", fields: {} }];
    const p = planSweep(w);
    expect(p.stranded).toEqual([]);
  });

  it("an empty world sweeps nothing — the control", () => {
    // Without this, a planSweep that returned everything it was handed would
    // pass several tests above purely by agreeing with them.
    expect(planSweep({ fields: [], mods: [], occs: [], ops: [] }))
      .toEqual({ fields: [], stranded: [], refused: [] });
  });
});

describe("isWrittenByAnyOp covers all three write forms", () => {
  const via = (config) => isWrittenByAnyOp("F", [{ pipeline: { steps: [{ config }] } }]);
  it("the path form", () => expect(via({ type: "UPDATE", path: "$t.fields.F.value" })).toBe(true));
  it("targetFieldId", () => expect(via({ type: "DATE_DIFF", targetFieldId: "F" })).toBe(true));
  it("fieldId", () => expect(via({ type: "SET_FIELD_VALUE", fieldId: "F" })).toBe(true));
  it("and says false for a field nobody names — the control", () =>
    expect(via({ type: "UPDATE", path: "$t.fields.OTHER.value" })).toBe(false));
});
