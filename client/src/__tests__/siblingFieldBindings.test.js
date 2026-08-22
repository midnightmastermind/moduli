// A new occurrence arrives wearing what its neighbours already wear.
//
// User, 2026-08-21: *"could you already have like fields set (what other
// occurances have in the place im placing it)"* / *"so if i have add an
// ingrediant, it already has all those fields set"*, and — asked directly —
// EVERY field the siblings bind, over "only what they all share" and over
// "copy the nearest sibling".
import { describe, it, expect } from "vitest";
import { siblingFieldBindings, siblingFieldIds, splitDisplayInput, normalizeFieldBindings,
  typeableFields, toInitialFields } from "../helpers/siblingFieldBindings.js";

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

describe("typeableFields — what the value step may ask for", () => {
  const F = {
    num:   { id: "num",   type: "number" },
    txt:   { id: "txt",   type: "text" },
    occ:   { id: "occ",   type: "occurrence" },
    disp:  { id: "disp",  type: "number", displayEnabled: true },
    trash: { id: "trash", type: "number", trashed: true },
    date:  { id: "date",  type: "date" },
  };
  const ids = Object.keys(F);

  it("keeps the types you can type or pick in one line", () => {
    expect(typeableFields(["num", "txt", "date"], F).map(f => f.id))
      .toEqual(["num", "txt", "date"]);
  });

  it("INCLUDES an occurrence field — every input type gets its real control", () => {
    // Corrected in-session: the first version rendered a hand-rolled subset of
    // input types, and the user's answer was "any input field should be valued
    // inside that editor". The step renders `Field` now, so there is nothing to
    // exclude on the grounds of "I did not write a box for it".
    expect(typeableFields(ids, F).map(f => f.id)).toContain("occ");
  });

  it("excludes a DISPLAY field even when its TYPE is typeable and its binding says input", () => {
    // Two independent guards cover this — displayEnabled on the FIELD and the
    // binding's role. This isolates the first: an operation writes the value, so
    // an input for it would be overwritten on the next load.
    expect(typeableFields(["disp"], F, { disp: "input" })).toEqual([]);
  });

  it("excludes a field whose BINDING role is display, even when the field is not display-enabled", () => {
    // And this isolates the second guard.
    expect(typeableFields(["num"], F, { num: "display" })).toEqual([]);
    expect(typeableFields(["num"], F, { num: "input" }).map(f => f.id)).toEqual(["num"]);
  });

  it("skips a trashed field and an id that resolves to nothing", () => {
    expect(typeableFields(["trash", "ghost", "num"], F).map(f => f.id)).toEqual(["num"]);
  });
});

describe("toInitialFields", () => {
  it("wraps each value in the stored {value, flow} shape", () => {
    expect(toInitialFields({ a: 5, b: "x" }))
      .toEqual({ a: { value: 5, flow: "in" }, b: { value: "x", flow: "in" } });
  });

  it("drops empty, null and undefined — a cleared box is not a value", () => {
    expect(toInitialFields({ a: "", b: null, c: undefined, d: 0 }))
      .toEqual({ d: { value: 0, flow: "in" } });   // 0 is a real number and survives
  });

  it("nothing in, empty out", () => {
    expect(toInitialFields()).toEqual({});
  });
});



describe("typeableFields — an INPUT field of any type gets a control", () => {
  const F = {
    occ:    { id: "occ",    type: "occurrence" },
    rating: { id: "rating", type: "rating" },
    dur:    { id: "dur",    type: "duration" },
    addr:   { id: "addr",   type: "address" },
    media:  { id: "media",  type: "media" },
    files:  { id: "files",  type: "files" },
    off:    { id: "off",    type: "number", inputEnabled: false },
  };
  it("includes an occurrence dropdown — the user's correction", () => {
    // "it shouldnt be just typable. any input field should be valued inside
    // that editor". A hand-rolled subset was the first version's mistake.
    expect(typeableFields(["occ", "rating", "dur", "addr"], F).map(f => f.id))
      .toEqual(["occ", "rating", "dur", "addr"]);
  });
  it("still excludes media and files — a menu has nowhere to put an upload", () => {
    expect(typeableFields(["media", "files"], F)).toEqual([]);
  });
  it("respects a field that says inputEnabled: false", () => {
    expect(typeableFields(["off"], F)).toEqual([]);
  });
});
