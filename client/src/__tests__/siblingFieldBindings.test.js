// A new occurrence arrives wearing what its neighbours already wear.
//
// User, 2026-08-21: *"could you already have like fields set (what other
// occurances have in the place im placing it)"* / *"so if i have add an
// ingrediant, it already has all those fields set"*, and — asked directly —
// EVERY field the siblings bind, over "only what they all share" and over
// "copy the nearest sibling".
import { describe, it, expect } from "vitest";
import { siblingFieldBindings, siblingFieldIds, splitDisplayInput, normalizeFieldBindings }
  from "../helpers/siblingFieldBindings.js";

const mods = {
  "m-a": { id: "m-a", role: "instance", fieldBindings: [
    { fieldId: "cal", role: "input" }, { fieldId: "protein", role: "input" }] },
  "m-b": { id: "m-b", role: "instance", fieldBindings: [
    { fieldId: "cal", role: "input" }, { fieldId: "iron", role: "input" }] },
  "m-disp": { id: "m-disp", role: "instance", fieldBindings: [
    { fieldId: "total", role: "display" }] },
  "m-container": { id: "m-container", role: "container", fieldBindings: [
    { fieldId: "header", role: "input" }] },
  "m-bare": { id: "m-bare", role: "instance" },
};
const occ = (id, moduleId) => ({ id, moduleId });
const world = (childIds, extra = {}) => ({
  occs: {
    dest: { id: "dest", occurrences: childIds },
    a: occ("a", "m-a"), b: occ("b", "m-b"), d: occ("d", "m-disp"),
    c: occ("c", "m-container"), bare: occ("bare", "m-bare"),
    ...extra,
  },
});
const run = (childIds) => {
  const { occs } = world(childIds);
  return siblingFieldBindings(occs.dest, occs, mods);
};

describe("siblingFieldBindings", () => {
  it("takes the UNION of what the siblings bind, not the intersection", () => {
    // The user's own pick. Intersection would give only `cal` here.
    expect(run(["a", "b"]).map(b => b.fieldId)).toEqual(["cal", "protein", "iron"]);
  });

  it("orders by FIRST SIGHTING — binding order is render order", () => {
    // Reversed sibling order must reverse the groups, or the new row's controls
    // appear in an order no existing row uses.
    expect(run(["b", "a"]).map(b => b.fieldId)).toEqual(["cal", "iron", "protein"]);
  });

  it("carries each binding's ROLE rather than flattening to input", () => {
    // A `display` field's value is written by an operation; as an "input" the
    // new row would show a typable box where its neighbours show a value.
    expect(run(["d"])).toEqual([{ fieldId: "total", role: "display" }]);
  });

  it("first sighting wins for the role too", () => {
    const occs = world(["d", "d2"], { d2: occ("d2", "m-disp2") }).occs;
    const m = { ...mods, "m-disp2": { id: "m-disp2", role: "instance",
      fieldBindings: [{ fieldId: "total", role: "input" }] } };
    occs.d2.moduleId = "m-disp2";
    expect(siblingFieldBindings(occs.dest, occs, m)).toEqual([{ fieldId: "total", role: "display" }]);
  });

  it("ignores nested CONTAINERS — their fields belong to their own header", () => {
    expect(run(["c", "a"]).map(b => b.fieldId)).toEqual(["cal", "protein"]);
  });

  it("returns nothing for an empty destination, so an empty board prefills nothing", () => {
    expect(run([])).toEqual([]);
    expect(siblingFieldBindings(null, {}, {})).toEqual([]);
    expect(siblingFieldBindings({ occurrences: null }, {}, {})).toEqual([]);
  });

  it("survives a sibling that binds nothing, and one that is missing entirely", () => {
    const { occs } = world(["bare", "ghost", "a"]);
    expect(siblingFieldBindings(occs.dest, occs, mods).map(b => b.fieldId))
      .toEqual(["cal", "protein"]);
  });

  it("stops scanning at maxSiblings — a feed board can hold hundreds", () => {
    const occs = { dest: { id: "dest", occurrences: ["a", "b"] }, a: occ("a", "m-a"), b: occ("b", "m-b") };
    expect(siblingFieldBindings(occs.dest, occs, mods, { maxSiblings: 1 }).map(b => b.fieldId))
      .toEqual(["cal", "protein"]);
  });

  it("siblingFieldIds is the ids of the same answer", () => {
    const { occs } = world(["a", "b"]);
    expect(siblingFieldIds(occs.dest, occs, mods)).toEqual(["cal", "protein", "iron"]);
  });
});

describe("splitDisplayInput", () => {
  it("splits on the field's own displayEnabled, display first", () => {
    const out = splitDisplayInput([
      { id: "x", displayEnabled: false }, { id: "y", displayEnabled: true }, { id: "z" }]);
    expect(out.display.map(f => f.id)).toEqual(["y"]);
    expect(out.input.map(f => f.id)).toEqual(["x", "z"]);
  });

  it("handles an empty list", () => {
    expect(splitDisplayInput([])).toEqual({ display: [], input: [] });
    expect(splitDisplayInput(null)).toEqual({ display: [], input: [] });
  });
});

describe("normalizeFieldBindings — the one mint-site rule", () => {
  it("bindings WIN over ids when both arrive", () => {
    expect(normalizeFieldBindings({
      fieldBindings: [{ fieldId: "a", role: "display" }], fieldIds: ["z"],
    })).toEqual([{ fieldId: "a", role: "display" }]);
  });

  it("bare ids default to input", () => {
    expect(normalizeFieldBindings({ fieldIds: ["a", "b"] }))
      .toEqual([{ fieldId: "a", role: "input" }, { fieldId: "b", role: "input" }]);
  });

  it("a binding with no role defaults to input", () => {
    expect(normalizeFieldBindings({ fieldBindings: [{ fieldId: "a" }] }))
      .toEqual([{ fieldId: "a", role: "input" }]);
  });

  it("drops a binding with no fieldId rather than minting a broken one", () => {
    expect(normalizeFieldBindings({ fieldBindings: [{ role: "input" }, null, { fieldId: "a" }] }))
      .toEqual([{ fieldId: "a", role: "input" }]);
  });

  it("hidden:true adds the flag App's shape carries", () => {
    expect(normalizeFieldBindings({ fieldIds: ["a"], hidden: true }))
      .toEqual([{ fieldId: "a", role: "input", hidden: false }]);
  });

  it("nothing in, empty out — so a bare item mints no fieldBindings key at all", () => {
    expect(normalizeFieldBindings()).toEqual([]);
    expect(normalizeFieldBindings({ fieldBindings: [], fieldIds: [] })).toEqual([]);
  });
});
