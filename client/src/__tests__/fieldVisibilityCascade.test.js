import { describe, it, expect } from "vitest";
import {
  getEffectiveFieldVisibilityForOccurrence,
  getEffectiveFieldRevealForOccurrence,
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

// ── WHEN the fields show — a separate cascade from WHICH ────────────────────
describe("getEffectiveFieldRevealForOccurrence", () => {
  const world = (occs) => ({ occurrencesById: Object.fromEntries(occs.map((o) => [o.id, o])) });

  it("defaults to always — an occurrence that says nothing shows its fields", () => {
    const s = world([{ id: "a" }]);
    expect(getEffectiveFieldRevealForOccurrence(s.occurrencesById.a, s)).toBe("always");
  });

  it("inherits hover from an ancestor, so a page can set it for everything inside", () => {
    const s = world([
      { id: "page", fieldReveal: "hover", occurrences: ["box"] },
      { id: "box", occurrences: ["row"] },
      { id: "row" },
    ]);
    expect(getEffectiveFieldRevealForOccurrence(s.occurrencesById.row, s)).toBe("hover");
  });

  it("NEAREST wins — an explicit 'always' re-enables under a hover ancestor", () => {
    // The discriminating case: without it, "always" is indistinguishable from
    // "unset" and there is no way to opt one card back out.
    const s = world([
      { id: "page", fieldReveal: "hover", occurrences: ["box"] },
      { id: "box", fieldReveal: "always", occurrences: ["row"] },
      { id: "row" },
    ]);
    expect(getEffectiveFieldRevealForOccurrence(s.occurrencesById.row, s)).toBe("always");
  });

  it("ignores an unrecognised value rather than treating it as a setting", () => {
    const s = world([
      { id: "page", fieldReveal: "hover", occurrences: ["row"] },
      { id: "row", fieldReveal: "sometimes" },
    ]);
    expect(getEffectiveFieldRevealForOccurrence(s.occurrencesById.row, s)).toBe("hover");
  });

  it("survives a parent cycle instead of hanging", () => {
    const s = world([
      { id: "a", occurrences: ["b"] },
      { id: "b", occurrences: ["a"] },
    ]);
    expect(getEffectiveFieldRevealForOccurrence(s.occurrencesById.a, s)).toBe("always");
  });

  it("is null-safe", () => {
    expect(getEffectiveFieldRevealForOccurrence(null, {})).toBe("always");
  });
});
