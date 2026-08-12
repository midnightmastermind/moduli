// TWO CASCADES, and the weight here is on what must NOT change.
// User, 2026-08-10: *"its a cascade of shown fields and auto applied fields."*
//
//   AUTO-APPLIED  which fields an occurrence HAS without its module binding them
//   SHOWN         of the fields it has, which ones render
//
// The properties that matter: an EMPTY auto-applied list behaves exactly as the
// code did before this existed; an explicit module binding always outranks an
// inherited one; and — the correction that produced this file — an auto-applied
// field renders WITHOUT needing a `show`-mode whitelist, because a whitelist
// hides everything it does not name. Migration 0064 used one on the Trackers
// page and hid every tracker's own fields.
import { describe, it, expect } from "vitest";
import { resolveOccurrenceFields, gridAutoAppliedFieldIds } from "../helpers/autoAppliedFields";
import { getEffectiveAutoAppliedFieldIds } from "../state/selectors";

const F = {
  "f-tags": { id: "f-tags", name: "Tags", type: "select" },
  "f-date": { id: "f-date", name: "Date", type: "date" },
  "f-note": { id: "f-note", name: "Note", type: "text" },
  "f-pic": { id: "f-pic", name: "Poster", type: "text" },
};
const APPLIED = ["f-tags", "f-date"];
const ids = (out) => out.map((x) => x.field.id);

describe("gridAutoAppliedFieldIds", () => {
  it("reads the grid's list and is defensive about a Mixed meta", () => {
    expect(gridAutoAppliedFieldIds({ meta: { autoAppliedFieldIds: APPLIED } })).toEqual(APPLIED);
    for (const bad of [null, {}, { meta: {} }, { meta: { autoAppliedFieldIds: "f-tags" } }]) {
      expect(gridAutoAppliedFieldIds(bad)).toEqual([]);
    }
  });

  it("drops non-string entries rather than passing them to a lookup", () => {
    expect(gridAutoAppliedFieldIds({ meta: { autoAppliedFieldIds: ["f-tags", null, 7, ""] } }))
      .toEqual(["f-tags"]);
  });
});

describe("resolveOccurrenceFields — NOTHING auto-applied", () => {
  // The safety property. This ships to every surface at once, so a grid that has
  // not opted in must be byte-identical to the behaviour before the feature.
  it("returns exactly the module's own visible bindings", () => {
    const module = { fieldBindings: [{ fieldId: "f-note", role: "input" }] };
    expect(ids(resolveOccurrenceFields({ module, fieldsById: F }))).toEqual(["f-note"]);
  });

  it("still skips hidden bindings and media-role bindings", () => {
    const module = {
      fieldBindings: [
        { fieldId: "f-note", role: "input" },
        { fieldId: "f-date", role: "input", hidden: true },
        { fieldId: "f-pic", role: "media" },
      ],
    };
    expect(ids(resolveOccurrenceFields({ module, fieldsById: F }))).toEqual(["f-note"]);
  });
});

describe("resolveOccurrenceFields — auto-applied fields", () => {
  it("adds them to a module that binds none", () => {
    const out = resolveOccurrenceFields({ module: {}, fieldsById: F, autoAppliedFieldIds: APPLIED });
    expect(ids(out)).toEqual(["f-tags", "f-date"]);
  });

  // THE CORRECTION. They used to be born hidden and revealed by naming them in a
  // show-mode fieldVisibility — but show-mode is a whitelist, so revealing one
  // field hid every other. This is the regression test for the Trackers page.
  it("RENDERS WITHOUT a show-mode whitelist, and does not suppress the module's own fields", () => {
    const module = { fieldBindings: [{ fieldId: "f-note", role: "input" }] };
    const out = resolveOccurrenceFields({ module, fieldsById: F, autoAppliedFieldIds: ["f-tags"] });
    expect(ids(out)).toEqual(["f-note", "f-tags"]);
  });

  it("marks the synthesized binding as coming from the cascade, and visible", () => {
    const [only] = resolveOccurrenceFields({ module: {}, fieldsById: F, autoAppliedFieldIds: ["f-tags"] });
    expect(only.binding.source).toBe("cascade");
    expect(only.binding.hidden).toBeFalsy();
  });

  // Precedence: the module said something SPECIFIC about this field (an order, a
  // role, a hidden flag). An inherited default must not overwrite that.
  it("an EXPLICIT binding wins — a module that binds one hidden keeps it hidden", () => {
    const module = { fieldBindings: [{ fieldId: "f-tags", role: "input", hidden: true }] };
    expect(ids(resolveOccurrenceFields({ module, fieldsById: F, autoAppliedFieldIds: APPLIED })))
      .toEqual(["f-date"]);
  });

  it("the SHOWN cascade still governs them — hide-mode can hide one", () => {
    const fv = { mode: "hide", fieldIds: ["f-tags"] };
    const out = resolveOccurrenceFields({
      module: {}, fieldsById: F, fieldVisibility: fv, autoAppliedFieldIds: APPLIED,
    });
    expect(ids(out)).toEqual(["f-date"]);
  });

  it("an id naming no field is skipped rather than rendering an empty pill", () => {
    const out = resolveOccurrenceFields({ module: {}, fieldsById: F, autoAppliedFieldIds: ["nope"] });
    expect(out).toEqual([]);
  });
});

describe("resolveOccurrenceFields — the SHOWN cascade, unchanged", () => {
  const module = {
    fieldBindings: [
      { fieldId: "f-note", role: "input" },
      { fieldId: "f-date", role: "input", hidden: true },
    ],
  };

  it("hide-mode drops the named field", () => {
    const fv = { mode: "hide", fieldIds: ["f-date"] };
    expect(ids(resolveOccurrenceFields({ module, fieldsById: F, fieldVisibility: fv }))).toEqual(["f-note"]);
  });

  it("show-mode FORCE-SHOWS a hidden binding — the Schedule Table's Date column", () => {
    const fv = { mode: "show", fieldIds: ["f-date"] };
    expect(ids(resolveOccurrenceFields({ module, fieldsById: F, fieldVisibility: fv }))).toEqual(["f-date"]);
  });

  it("show-mode surfaces a field bound NOWHERE (values stamped by defaultFields)", () => {
    const fv = { mode: "show", fieldIds: ["f-note", "f-pic"] };
    expect(ids(resolveOccurrenceFields({ module, fieldsById: F, fieldVisibility: fv })))
      .toEqual(["f-note", "f-pic"]);
  });

  it("renders in binding order, not the order fields happen to be listed", () => {
    const m = {
      fieldBindings: [
        { fieldId: "f-note", role: "input", order: 2 },
        { fieldId: "f-date", role: "input", order: 1 },
      ],
    };
    expect(ids(resolveOccurrenceFields({ module: m, fieldsById: F }))).toEqual(["f-date", "f-note"]);
  });
});

describe("getEffectiveAutoAppliedFieldIds — nearest wins, rooted at the grid", () => {
  //   page ── container ── row
  const OCCS = {
    page: { id: "page", occurrences: ["cont"] },
    cont: { id: "cont", occurrences: ["row"] },
    row: { id: "row" },
  };
  const GRID = { meta: { autoAppliedFieldIds: APPLIED } };
  const at = (id, occs = OCCS, grid = GRID) =>
    getEffectiveAutoAppliedFieldIds(occs[id], { occurrencesById: occs, grid });

  it("inherits the grid's list when nothing in the chain says otherwise", () => {
    expect(at("row")).toEqual(APPLIED);
  });

  it("a grid naming none gives every occurrence none", () => {
    expect(at("row", OCCS, {})).toEqual([]);
  });

  // *"it can be passed down as on but turned off on occurances if i want."*
  // A LIST, not a flag — `[]` is how an occurrence carries none, which is what
  // makes turning it off fall out of the same mechanism as changing it.
  it("an occurrence can turn them OFF for itself and everything under it", () => {
    const occs = { ...OCCS, cont: { ...OCCS.cont, autoAppliedFieldIds: [] } };
    expect(at("cont", occs)).toEqual([]);
    expect(at("row", occs)).toEqual([]);
  });

  it("a NEARER override beats a farther one", () => {
    const occs = {
      ...OCCS,
      cont: { ...OCCS.cont, autoAppliedFieldIds: [] },
      row: { ...OCCS.row, autoAppliedFieldIds: ["f-note"] },
    };
    expect(at("row", occs)).toEqual(["f-note"]);
  });

  // A cascade only the grid can set is not a cascade.
  it("any level may ADD its own — a page can apply a field to everything under it", () => {
    const occs = { ...OCCS, page: { ...OCCS.page, autoAppliedFieldIds: ["f-note"] } };
    expect(at("row", occs)).toEqual(["f-note"]);
  });

  it("absent means INHERIT and empty means NONE — they are not the same answer", () => {
    const inherits = { ...OCCS, cont: { ...OCCS.cont } };
    const carriesNone = { ...OCCS, cont: { ...OCCS.cont, autoAppliedFieldIds: [] } };
    expect(at("cont", inherits)).toEqual(APPLIED);
    expect(at("cont", carriesNone)).toEqual([]);
  });

  it("a cycle in the parent chain terminates instead of hanging", () => {
    const occs = { a: { id: "a", occurrences: ["b"] }, b: { id: "b", occurrences: ["a"] } };
    expect(getEffectiveAutoAppliedFieldIds(occs.a, { occurrencesById: occs, grid: GRID })).toEqual(APPLIED);
  });

  it("falls back to parentId when the reverse map has no entry", () => {
    const occs = { p: { id: "p", autoAppliedFieldIds: ["f-note"] }, k: { id: "k", parentId: "p" } };
    expect(getEffectiveAutoAppliedFieldIds(occs.k, { occurrencesById: occs, grid: GRID })).toEqual(["f-note"]);
  });
});
