// SAME-NAMED OCCURRENCES GET THEIR ANCESTOR CHAIN.
//
// USER, 2026-09-23: *"in those places where its hard to tell occurances apart
// due to same name (diff selects and such), we need to show the occurances
// ancestor chain"*. Prompted by a template picker offering two identical
// "Morning Slot" radios, and by the occurrence search returning six same-named
// hits of which only one could be opened (2026-09-22 (7), reported not fixed).
//
// Sharing a label is the NORM: 6,763 of poms grid's 22,479 rows carry one some
// other row also has ("Sleep" x158). The decision that makes this usable rather
// than noisy is that only the options colliding INSIDE THE LIST get a crumb.
import { describe, it, expect } from "vitest";
import {
  crumbFromAncestors, ancestorIdsOf, disambiguateOptions, CRUMB_SEP,
} from "../helpers/occurrenceCrumbs";

const OCCS = {
  page:  { id: "page",  moduleId: "m-page",  occurrences: ["slotA", "slotB"] },
  slotA: { id: "slotA", moduleId: "m-9am",   occurrences: ["a1"] },
  slotB: { id: "slotB", moduleId: "m-12pm",  occurrences: ["b1"] },
  a1:    { id: "a1",    moduleId: "m-sleep" },
  b1:    { id: "b1",    moduleId: "m-sleep" },
};
const MODS = {
  "m-page":  { id: "m-page",  label: "Schedule", role: "page" },
  "m-9am":   { id: "m-9am",   label: "9:00am",   role: "container" },
  "m-12pm":  { id: "m-12pm",  label: "12:00pm",  role: "container" },
  "m-sleep": { id: "m-sleep", label: "Sleep",    role: "instance" },
};
const MAPS = { occurrencesById: OCCS, modulesById: MODS };

describe("crumbFromAncestors", () => {
  it("reads root-most first, from a closest-first ancestor list", () => {
    expect(crumbFromAncestors(["slotA", "page"], MAPS)).toBe(`Schedule${CRUMB_SEP}9:00am`);
  });

  it("shows the WHOLE chain, up to and including the page", () => {
    // USER, 2026-09-23: "and yes full ancestory". An earlier version kept only
    // the nearest two, which on poms hides a real level — a schedule row sits
    // under `Schedule Template › Schedule: Routine › 6:00am`.
    const occs = {
      ...OCCS,
      mid:  { id: "mid",  moduleId: "m-mid" },
      page: { id: "page", moduleId: "m-page", occurrences: ["slotA", "slotB"] },
    };
    const mods = { ...MODS, "m-mid": { label: "Schedule: Routine", role: "container" } };
    expect(crumbFromAncestors(["slotA", "mid", "page"], { occurrencesById: occs, modulesById: mods }))
      .toBe(`Schedule${CRUMB_SEP}Schedule: Routine${CRUMB_SEP}9:00am`);
  });

  it("STOPS at the page — what sits above it is layout chrome", () => {
    // A panel is called "Panel D"; adding it tells you nothing about where the
    // row is. This is the control for "full chain" not meaning "walk forever".
    const occs = { ...OCCS, panel: { id: "panel", moduleId: "m-panel" } };
    const mods = { ...MODS, "m-panel": { label: "Panel D", role: "panel" } };
    const out = crumbFromAncestors(["slotA", "page", "panel"], { occurrencesById: occs, modulesById: mods });
    expect(out).toBe(`Schedule${CRUMB_SEP}9:00am`);
    expect(out).not.toContain("Panel D");
  });

  it("resolves a FOLDER ancestor — a page is filed, not listed", () => {
    expect(crumbFromAncestors(["f1"], {
      occurrencesById: {}, modulesById: {}, foldersById: { f1: { id: "f1", name: "Templates" } },
    })).toBe("Templates");
  });

  it("says nothing when there is nothing to say", () => {
    expect(crumbFromAncestors([], MAPS)).toBe("");
    expect(crumbFromAncestors(undefined, MAPS)).toBe("");
  });
});

describe("ancestorIdsOf", () => {
  it("prefers the occurrences[] reverse map over parentId", () => {
    // Placement IS the parent's child list: a row can be listed by one
    // occurrence while parentId names another.
    const occs = { ...OCCS, a1: { ...OCCS.a1, parentId: "elsewhere" },
                   elsewhere: { id: "elsewhere", moduleId: "m-page" } };
    expect(ancestorIdsOf("a1", { occurrencesById: occs })[0]).toBe("slotA");
  });

  it("falls back to parentId, which is how a page reaches its folder", () => {
    const occs = { p: { id: "p", parentId: "f1" } };
    expect(ancestorIdsOf("p", { occurrencesById: occs })).toEqual(["f1"]);
  });

  it("terminates on a cycle", () => {
    const occs = { x: { id: "x", occurrences: ["y"] }, y: { id: "y", occurrences: ["x"] } };
    expect(ancestorIdsOf("x", { occurrencesById: occs }).length).toBeLessThan(5);
  });
});

describe("disambiguateOptions — only the collisions get a crumb", () => {
  const crumbOf = (o) => crumbFromAncestors(o._anc, MAPS);

  it("crumbs BOTH sides of a collision", () => {
    const { options, ambiguous } = disambiguateOptions([
      { value: "a1", label: "Sleep", _anc: ["slotA", "page"] },
      { value: "b1", label: "Sleep", _anc: ["slotB", "page"] },
    ], crumbOf);
    expect(ambiguous).toBe(2);
    expect(options.map(o => o.label)).toEqual([
      `Schedule${CRUMB_SEP}9:00am${CRUMB_SEP}Sleep`,
      `Schedule${CRUMB_SEP}12:00pm${CRUMB_SEP}Sleep`,
    ]);
  });

  it("LEAVES A UNIQUE LABEL ALONE — the whole point", () => {
    // Crumbing everything would decorate poms' 15,901 unique labels to help
    // 1,972, and make the common case worse to scan.
    const { options, ambiguous } = disambiguateOptions([
      { value: "a1", label: "Sleep",   _anc: ["slotA", "page"] },
      { value: "b1", label: "Journal", _anc: ["slotB", "page"] },
    ], crumbOf);
    expect(ambiguous).toBe(0);
    expect(options.map(o => o.label)).toEqual(["Sleep", "Journal"]);
  });

  it("never changes an option's VALUE", () => {
    const { options } = disambiguateOptions([
      { value: "a1", label: "Sleep", _anc: ["slotA", "page"] },
      { value: "b1", label: "Sleep", _anc: ["slotB", "page"] },
    ], crumbOf);
    expect(options.map(o => o.value)).toEqual(["a1", "b1"]);
  });

  it("REPORTS what a chain cannot separate instead of pretending", () => {
    // Two rows sharing a label AND a parent — the template picker's shape,
    // where every template is a child of the one Templates folder.
    const { unresolved } = disambiguateOptions([
      { value: "t1", label: "Morning Slot", _anc: ["slotA"] },
      { value: "t2", label: "Morning Slot", _anc: ["slotA"] },
    ], crumbOf);
    expect(unresolved).toBe(2);
  });

  it("leaves an option alone when it has no chain to show", () => {
    const { options } = disambiguateOptions([
      { value: "x", label: "Sleep", _anc: [] },
      { value: "y", label: "Sleep", _anc: [] },
    ], crumbOf);
    expect(options.map(o => o.label)).toEqual(["Sleep", "Sleep"]);
  });

  it("is a no-op on a list too short to collide", () => {
    const one = [{ value: "a", label: "Sleep" }];
    expect(disambiguateOptions(one, crumbOf).options).toBe(one);
  });
});

// ── THE WIRING, which the unit tests above cannot prove ────────────────────
// A helper agreeing with itself says nothing about whether `resolveOptions`
// calls it. This drives the REAL resolver over a grid holding two rows that
// share a label, which is the shape the user reported.
describe("resolveOptions crumbs the collisions it returns", () => {
  const ctx = {
    occurrencesById: {
      page:  { id: "page",  moduleId: "m-page",  occurrences: ["slotA", "slotB"] },
      slotA: { id: "slotA", moduleId: "m-9am",   occurrences: ["a1"] },
      slotB: { id: "slotB", moduleId: "m-12pm",  occurrences: ["b1"] },
      a1:    { id: "a1",    moduleId: "m-sleep", fields: { f1: { value: "task" } } },
      b1:    { id: "b1",    moduleId: "m-sleep", fields: { f1: { value: "task" } } },
      c1:    { id: "c1",    moduleId: "m-run",   fields: { f1: { value: "task" } },
               // listed by slotA too, so it has a chain available
               },
    },
    modulesById: {
      "m-page":  { id: "m-page",  label: "Schedule", role: "page" },
      "m-9am":   { id: "m-9am",   label: "9:00am",   role: "container" },
      "m-12pm":  { id: "m-12pm",  label: "12:00pm",  role: "container" },
      "m-sleep": { id: "m-sleep", label: "Sleep",    role: "instance" },
      "m-run":   { id: "m-run",   label: "Run",      role: "instance" },
    },
    fieldsById: {}, foldersById: {},
  };
  const field = { type: "occurrence", meta: { optionsSource: {
    mode: "find",
    find: {
      over: "$allInstances",
      predicate: { rules: [{ left: "fields.f1.value", comparator: "IS", right: "task" }] },
      valuePath: "id", labelPath: "label",
    },
  } } };

  it("the two Sleeps come back distinguishable, the Run untouched", async () => {
    const { resolveOptions } = await import("../helpers/optionsResolver");
    const { options } = resolveOptions(field, ctx);
    const byValue = Object.fromEntries(options.map(o => [o.value, o.label]));
    expect(byValue.a1).toBe(`Schedule${CRUMB_SEP}9:00am${CRUMB_SEP}Sleep`);
    expect(byValue.b1).toBe(`Schedule${CRUMB_SEP}12:00pm${CRUMB_SEP}Sleep`);
    expect(byValue.c1).toBe("Run");          // unique — left alone
  });
});
