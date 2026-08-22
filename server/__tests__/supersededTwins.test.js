// The Ingredients board shows "Eggs" twice: the plan's `1 large` row and the
// 2026-07-28 seed's serving-less one, with different macros. No meal points at
// the seed row — but a human picking from a dropdown can, which is the `0114`
// wrong-pointer trap waiting to happen.
//
// Every clause here is a refusal, because the cost of a wrong untag is a food
// disappearing from the board a meal might need.
import { describe, it, expect } from "vitest";
import { supersededTwins, referencedIds }
  from "../migrations/0195-the-superseded-ingredient-twins.mjs";

const TAG = "bc";
const occ = (id, label, extra = {}) => ({
  id, moduleId: `m-${id}`, label, fields: { [TAG]: { value: ["ingredient"] } }, ...extra,
});
const mod = (id, serving) => ({
  id: `m-${id}`, role: "instance", ...(serving === undefined ? {} : { meta: { servingSize: serving } }),
});
const world = () => ({
  occs: [occ("old", "Eggs"), occ("new", "Eggs")],
  mods: [mod("old"), mod("new", "1 large")],
  tagFieldId: TAG,
});

describe("supersededTwins", () => {
  it("untags the serving-less row when a serving-bearing twin exists", () => {
    const t = supersededTwins(world());
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ id: "old", name: "Eggs", twinId: "new", twinServing: "1 large" });
  });

  it("never untags the serving-bearing one — the control", () => {
    // Without this, a predicate that returned both rows would pass the test
    // above and quietly take the ingredient the meals actually use.
    expect(supersededTwins(world()).map((t) => t.id)).not.toContain("new");
  });

  it("REFUSES when BOTH same-named rows have a serving size", () => {
    // The hazard the serving-less clause exists for, and it had no test until
    // an A/B against that clause failed NOTHING. Without it each row finds the
    // other as its twin and BOTH are untagged — the ingredient vanishes from
    // the board entirely. Ambiguity is a refusal, not a coin flip.
    const w = world();
    w.mods = [mod("old", "1 large"), mod("new", "1 large")];
    expect(supersededTwins(w)).toEqual([]);
  });

  it("leaves a food with NO twin alone — a catalog entry is not a duplicate", () => {
    const w = world();
    w.occs = [occ("solo", "Salmon")]; w.mods = [mod("solo")];
    expect(supersededTwins(w)).toEqual([]);
  });

  it("REFUSES when something references the row", () => {
    const w = world();
    w.occs.push({ id: "meal", moduleId: "m-meal", fields: { ing: { value: ["old"] } } });
    w.mods.push({ id: "m-meal", role: "instance" });
    expect(supersededTwins(w)).toEqual([]);
  });

  it("REFUSES a reference held as a bare string, not an array", () => {
    const w = world();
    w.occs.push({ id: "meal", moduleId: "m-meal", fields: { ing: { value: "old" } } });
    w.mods.push({ id: "m-meal", role: "instance" });
    expect(supersededTwins(w)).toEqual([]);
  });

  it("skips the board CONTAINER, which carries the tag by design", () => {
    // 2026-07-25: every board container carries its own tag value plus a feed on
    // it — that is how the board knows what to materialise. Treating it as an
    // ingredient would untag the board off itself.
    const w = world();
    w.occs.push(occ("board", "Eggs"));
    w.mods.push({ id: "m-board", role: "container", kind: "board" });
    expect(supersededTwins(w).map((t) => t.id)).toEqual(["old"]);
  });

  it("skips a FEED COPY — a copy is regenerated, never a source", () => {
    const w = world();
    w.occs.push(occ("copy", "Eggs", { meta: { feedSourceId: "new" } }));
    w.mods.push(mod("copy"));
    expect(supersededTwins(w).map((t) => t.id)).toEqual(["old"]);
  });

  it("falls back to the MODULE label when the occurrence has none", () => {
    const w = world();
    w.occs[0].label = null; w.mods[0].label = "Eggs";
    expect(supersededTwins(w)).toHaveLength(1);
  });

  it("ignores rows that do not carry the tag at all", () => {
    const w = world();
    w.occs[0].fields[TAG].value = ["grocery"];
    expect(supersededTwins(w)).toEqual([]);
  });
});

describe("referencedIds", () => {
  it("collects ids from array AND scalar field values", () => {
    const s = referencedIds([{ fields: { a: { value: ["x", "y"] }, b: { value: "z" } } }]);
    expect([...s].sort()).toEqual(["x", "y", "z"]);
  });
  it("ignores non-string values so a number cannot mask an id", () => {
    expect([...referencedIds([{ fields: { a: { value: 42 } } }])]).toEqual([]);
  });
});
