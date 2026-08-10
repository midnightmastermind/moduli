// The grid says which fields EVERY occurrence carries. The weight here is on
// what must NOT change: a grid naming none must behave exactly as before, and an
// explicit module binding must always outrank the grid-wide default.
import { describe, it, expect } from "vitest";
import { resolveOccurrenceFields, universalFieldIds } from "../helpers/universalFields";

const F = {
  "f-tags": { id: "f-tags", name: "Tags", type: "select" },
  "f-date": { id: "f-date", name: "Date", type: "date" },
  "f-note": { id: "f-note", name: "Note", type: "text" },
  "f-pic": { id: "f-pic", name: "Poster", type: "text" },
};
const GRID = { meta: { universalFieldIds: ["f-tags", "f-date"] } };
const ids = (out) => out.map((x) => x.field.id);

describe("universalFieldIds", () => {
  it("reads the grid's list and is defensive about a Mixed meta", () => {
    expect(universalFieldIds(GRID)).toEqual(["f-tags", "f-date"]);
    for (const bad of [null, {}, { meta: {} }, { meta: { universalFieldIds: "f-tags" } }]) {
      expect(universalFieldIds(bad)).toEqual([]);
    }
  });

  it("drops non-string entries rather than passing them to a lookup", () => {
    expect(universalFieldIds({ meta: { universalFieldIds: ["f-tags", null, 7, ""] } })).toEqual(["f-tags"]);
  });
});

describe("resolveOccurrenceFields — a grid naming NO universal fields", () => {
  // The safety property. This ships to every surface at once, so a grid that
  // has not opted in must be byte-identical to before.
  it("returns exactly the module's own visible bindings", () => {
    const module = { fieldBindings: [{ fieldId: "f-note", role: "input" }] };
    expect(ids(resolveOccurrenceFields({ module, grid: {}, fieldsById: F }))).toEqual(["f-note"]);
  });

  it("still skips hidden bindings and media-role bindings", () => {
    const module = {
      fieldBindings: [
        { fieldId: "f-note", role: "input" },
        { fieldId: "f-date", role: "input", hidden: true },
        { fieldId: "f-pic", role: "media" },
      ],
    };
    expect(ids(resolveOccurrenceFields({ module, grid: {}, fieldsById: F }))).toEqual(["f-note"]);
  });
});

describe("resolveOccurrenceFields — universal fields", () => {
  it("adds the grid's fields to a module that binds none", () => {
    // Hidden by default, so they only RESOLVE here; the show test below is what
    // proves they can actually appear.
    const out = resolveOccurrenceFields({ module: {}, grid: GRID, fieldsById: F });
    expect(out).toEqual([]);   // born hidden → nothing renders yet
  });

  it("shows a universal field when the occurrence opts it in", () => {
    const fv = { mode: "show", fieldIds: ["f-tags"] };
    const out = resolveOccurrenceFields({ module: {}, grid: GRID, fieldsById: F, fieldVisibility: fv });
    expect(ids(out)).toEqual(["f-tags"]);
    // …and the binding it hands on must not still claim to be hidden, or every
    // downstream reader of `binding.hidden` disagrees with the screen.
    expect(out[0].binding.hidden).toBe(false);
  });

  it("marks a synthesized binding as coming from the GRID, not the module", () => {
    const fv = { mode: "show", fieldIds: ["f-tags"] };
    const [only] = resolveOccurrenceFields({ module: {}, grid: GRID, fieldsById: F, fieldVisibility: fv });
    expect(only.binding.source).toBe("grid");
  });

  it("an EXPLICIT module binding outranks the grid default", () => {
    // The module said something specific (an order, a role, visible-by-default).
    // A grid-wide default must not overwrite it — the same precedence an
    // explicitly chosen upload folder gets over the computed one.
    const module = { fieldBindings: [{ fieldId: "f-tags", role: "input", order: 3 }] };
    const out = resolveOccurrenceFields({ module, grid: GRID, fieldsById: F });
    expect(ids(out)).toEqual(["f-tags"]);          // visible: the module did not hide it
    expect(out[0].binding.order).toBe(3);
    expect(out[0].binding.source).toBeUndefined();
  });

  it("never duplicates a field the module already binds", () => {
    const module = { fieldBindings: [{ fieldId: "f-tags", role: "input" }] };
    const fv = { mode: "show", fieldIds: ["f-tags"] };
    expect(ids(resolveOccurrenceFields({ module, grid: GRID, fieldsById: F, fieldVisibility: fv })))
      .toEqual(["f-tags"]);
  });

  it("ignores a universal id naming a field that does not exist", () => {
    const grid = { meta: { universalFieldIds: ["f-gone"] } };
    const fv = { mode: "show", fieldIds: ["f-gone"] };
    expect(resolveOccurrenceFields({ module: {}, grid, fieldsById: F, fieldVisibility: fv })).toEqual([]);
  });
});

describe("resolveOccurrenceFields — visibility rules match the instance path", () => {
  const module = {
    fieldBindings: [
      { fieldId: "f-note", role: "input" },
      { fieldId: "f-date", role: "input" },
    ],
  };

  it("hide mode is a blacklist", () => {
    const fv = { mode: "hide", fieldIds: ["f-date"] };
    expect(ids(resolveOccurrenceFields({ module, grid: {}, fieldsById: F, fieldVisibility: fv }))).toEqual(["f-note"]);
  });

  it("show mode is a whitelist", () => {
    const fv = { mode: "show", fieldIds: ["f-date"] };
    expect(ids(resolveOccurrenceFields({ module, grid: {}, fieldsById: F, fieldVisibility: fv }))).toEqual(["f-date"]);
  });

  it("off mode imposes no constraint", () => {
    const fv = { mode: "off" };
    expect(ids(resolveOccurrenceFields({ module, grid: {}, fieldsById: F, fieldVisibility: fv }))).toEqual(["f-note", "f-date"]);
  });

  it("orders by the binding's order", () => {
    const m = {
      fieldBindings: [
        { fieldId: "f-note", role: "input", order: 2 },
        { fieldId: "f-date", role: "input", order: 1 },
      ],
    };
    expect(ids(resolveOccurrenceFields({ module: m, grid: {}, fieldsById: F }))).toEqual(["f-date", "f-note"]);
  });
});
