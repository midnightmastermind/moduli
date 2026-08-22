// `unrenderedWrites` — the predicate behind 0192.
//
// The defect: `Fitness: Today's Prescription` writes six movements onto the
// `Workout Log` tile every load, and that tile's module binds none of them. The
// op has a test asserting it WRITES; nothing asserted anything renders.
//
// The scope that matters is `displayEnabled`. The same rule without it matches a
// SEVENTH pair on the live grid — `Schedule: Place Cycle Day` writing `Cycle Day`
// onto the `Last Opened` marker, a value stored to make a rebuild stable and
// never meant to be seen. Binding that would put an internal marker on screen.
import { describe, it, expect } from "vitest";
import { unrenderedWrites } from "../migrations/0192-a-display-field-nothing-renders.mjs";

const world = ({ binds = [], displayEnabled = true, path = "$tile.fields.F1.value" } = {}) => ({
  ops: [{ name: "Writer", pipeline: { steps: [
    { config: { type: "INIT_VAR", name: "$tile", expr: "$allItemsById.occ1" } },
    { config: { type: "UPDATE", path, value: "$x" } },
  ] } }],
  occs: [{ id: "occ1", moduleId: "mod1" }],
  mods: [{ id: "mod1", label: "Tile", fieldBindings: binds.map((f) => ({ fieldId: f, role: "display", order: 0 })) }],
  fields: [{ id: "F1", name: "Slot 1", displayEnabled },
           { id: "F2", name: "Marker", displayEnabled: false }],
});

describe("unrenderedWrites", () => {
  it("flags a display field written onto a tile that does not bind it", () => {
    const g = unrenderedWrites(world());
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ moduleId: "mod1", fieldId: "F1", fieldName: "Slot 1", op: "Writer" });
  });

  it("stays quiet when the tile DOES bind it — the control", () => {
    // Without this, a predicate that flagged every write would pass the test
    // above and read as working.
    expect(unrenderedWrites(world({ binds: ["F1"] }))).toEqual([]);
  });

  it("ignores a NON-display field — a stored marker is not a render gap", () => {
    expect(unrenderedWrites(world({ path: "$tile.fields.F2.value" }))).toEqual([]);
  });

  it("...and flags that same field once it is display-enabled", () => {
    // Proves the previous test is discriminating on displayEnabled and not on
    // some other property of F2.
    const w = world({ path: "$tile.fields.F2.value" });
    w.fields[1].displayEnabled = true;
    expect(unrenderedWrites(w)).toHaveLength(1);
  });

  it("ignores a write through a var that is not picker-direct", () => {
    // `$item` inside a loop names a different row each iteration; there is no
    // single tile to bind, so it cannot be this defect.
    const w = world();
    w.ops[0].pipeline.steps[0] = { config: { type: "INIT_VAR", name: "$tile", expr: "$someOther.thing" } };
    expect(unrenderedWrites(w)).toEqual([]);
  });

  it("reaches writes nested in a branch or a loop body", () => {
    const w = world();
    w.ops[0].pipeline.steps = [
      w.ops[0].pipeline.steps[0],
      { config: { type: "LOOP" }, body: [{ config: { type: "IF" }, then: [
        { config: { type: "UPDATE", path: "$tile.fields.F1.value", value: "$x" } }] }] },
    ];
    expect(unrenderedWrites(w)).toHaveLength(1);
  });

  it("reports one pair per (tile, field) however many times it is written", () => {
    // The live op CLEARS all six slots and then writes them, so every field is
    // written twice; a per-write list would double every binding.
    const w = world();
    w.ops[0].pipeline.steps.push({ config: { type: "UPDATE", path: "$tile.fields.F1.value", value: "$y" } });
    expect(unrenderedWrites(w)).toHaveLength(1);
  });

  it("a tile whose occurrence is missing is skipped, not a crash", () => {
    const w = world(); w.occs = [];
    expect(unrenderedWrites(w)).toEqual([]);
  });
});
