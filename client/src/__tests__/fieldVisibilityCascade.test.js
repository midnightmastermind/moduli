import { describe, it, expect } from "vitest";
import {
  getEffectiveFieldVisibilityForOccurrence,
  fieldPassesVisibility,
} from "../state/selectors";

const makeState = (occs) => ({
  occurrencesById: Object.fromEntries(occs.map(o => [o.id, o])),
});

describe("getEffectiveFieldVisibilityForOccurrence", () => {
  it("returns null when nothing in the chain sets fieldVisibility", () => {
    const state = makeState([
      { id: "page", parentId: null },
      { id: "cont", parentId: "page" },
      { id: "inst", parentId: "cont" },
    ]);
    expect(getEffectiveFieldVisibilityForOccurrence(state.occurrencesById.inst, state))
      .toBeNull();
  });

  it("inherits the nearest ancestor's setting", () => {
    const state = makeState([
      { id: "page", parentId: null, fieldVisibility: { mode: "show", fieldIds: ["f1"] } },
      { id: "cont", parentId: "page" },
      { id: "inst", parentId: "cont" },
    ]);
    expect(getEffectiveFieldVisibilityForOccurrence(state.occurrencesById.inst, state))
      .toEqual({ mode: "show", fieldIds: ["f1"] });
  });

  it("a descendant's own setting overrides the ancestor's", () => {
    const state = makeState([
      { id: "page", parentId: null, fieldVisibility: { mode: "show", fieldIds: ["f1"] } },
      { id: "cont", parentId: "page", fieldVisibility: { mode: "hide", fieldIds: ["f2"] } },
      { id: "inst", parentId: "cont" },
    ]);
    expect(getEffectiveFieldVisibilityForOccurrence(state.occurrencesById.inst, state))
      .toEqual({ mode: "hide", fieldIds: ["f2"] });
  });

  it("mode:'off' on a descendant turns the inherited filter off (returns null)", () => {
    const state = makeState([
      { id: "page", parentId: null, fieldVisibility: { mode: "show", fieldIds: ["f1"] } },
      { id: "cont", parentId: "page", fieldVisibility: { mode: "off" } },
      { id: "inst", parentId: "cont" },
    ]);
    expect(getEffectiveFieldVisibilityForOccurrence(state.occurrencesById.inst, state))
      .toBeNull();
  });

  it("walks the occurrences[] reverse map when parentId is unset (page/container case)", () => {
    const state = makeState([
      { id: "page", parentId: null, occurrences: ["cont"], fieldVisibility: { mode: "hide", fieldIds: ["x"] } },
      { id: "cont", parentId: null, occurrences: ["inst"] },
      { id: "inst", parentId: null },
    ]);
    expect(getEffectiveFieldVisibilityForOccurrence(state.occurrencesById.inst, state))
      .toEqual({ mode: "hide", fieldIds: ["x"] });
  });

  it("returns null for a null occurrence", () => {
    expect(getEffectiveFieldVisibilityForOccurrence(null, makeState([]))).toBeNull();
  });
});

describe("fieldPassesVisibility", () => {
  it("passes everything when fv is null / off / empty", () => {
    expect(fieldPassesVisibility("a", null)).toBe(true);
    expect(fieldPassesVisibility("a", { mode: "off" })).toBe(true);
    expect(fieldPassesVisibility("a", {})).toBe(true);
  });

  it("show = whitelist", () => {
    const fv = { mode: "show", fieldIds: ["a", "b"] };
    expect(fieldPassesVisibility("a", fv)).toBe(true);
    expect(fieldPassesVisibility("c", fv)).toBe(false);
  });

  it("hide = blacklist", () => {
    const fv = { mode: "hide", fieldIds: ["a"] };
    expect(fieldPassesVisibility("a", fv)).toBe(false);
    expect(fieldPassesVisibility("b", fv)).toBe(true);
  });
});
