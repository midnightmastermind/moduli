// The dep for option resolution was the grid-wide occurrence COUNT, so any
// create anywhere re-resolved every option-resolving field: 756 field renders
// on an idle load and 615 on a SINGLE drop.
//
// It moved for the wrong reason. 38 of this grid's 49 find-mode fields select
// by a tag that lives on BOARD ITEMS; a schedule placement — what a drag
// creates — carries no such tag and belongs to no pool.
import { describe, it, expect } from "vitest";
import { optionScopeFieldIds, poolKeyFrom } from "../helpers/optionPoolKey";

const findField = (rules) => ({ meta: { optionsSource: { mode: "find", predicate: { rules } } } });

describe("optionScopeFieldIds", () => {
  it("collects the fields find predicates scope by", () => {
    const ids = optionScopeFieldIds([
      findField([{ left: "fields.boardCat.value", comparator: "CONTAINS", right: "meal" },
                 { left: "meta.feedSourceId", comparator: "IS_EMPTY" }]),
      findField([{ left: "fields.library.value", comparator: "IS", right: "movie" }]),
    ]);
    expect([...ids].sort()).toEqual(["boardCat", "library"]);
  });

  it("walks NESTED groups — 8 of the 49 are an OR of board categories", () => {
    const ids = optionScopeFieldIds([findField([
      { rules: [{ left: "fields.boardCat.value", comparator: "CONTAINS", right: "a" },
                { left: "fields.other.value", comparator: "CONTAINS", right: "b" }] },
    ])]);
    expect([...ids].sort()).toEqual(["boardCat", "other"]);
  });

  it("ignores fields that are not find-mode", () => {
    // A manual list has no pool; including its (absent) predicate would widen
    // the key back toward the count it replaces.
    expect(optionScopeFieldIds([{ meta: { optionsSource: { mode: "manual", values: [1, 2] } } }]).size).toBe(0);
    expect(optionScopeFieldIds([{}, null, { meta: {} }]).size).toBe(0);
  });
});

describe("poolKeyFrom", () => {
  const scope = new Set(["boardCat"]);
  const item = (tag) => ({ fields: { boardCat: { value: tag } } });
  const placement = () => ({ fields: { someOther: { value: "x" } } });

  it("counts board items and IGNORES a schedule placement", () => {
    // The whole point: dropping a routine into a slot must not invalidate
    // every dropdown on the grid.
    const before = [item("meal"), item("meal"), placement()];
    const after = [...before, placement(), placement()];
    expect(poolKeyFrom(before, scope)).toBe(2);
    expect(poolKeyFrom(after, scope), "a drop moved the key").toBe(2);
  });

  it("DOES move when a real board item is added — the control", () => {
    // Without this the key could be a constant and would look like a fix.
    expect(poolKeyFrom([item("meal")], scope)).toBe(1);
    expect(poolKeyFrom([item("meal"), item("grocery")], scope)).toBe(2);
  });

  it("ignores feed copies, which feedSync re-mints every pass", () => {
    const copy = { fields: { boardCat: { value: "meal" } }, meta: { feedSourceId: "src" } };
    expect(poolKeyFrom([item("meal"), copy], scope)).toBe(1);
  });

  it("treats an empty value as not in a pool", () => {
    for (const v of [undefined, null, "", []]) {
      expect(poolKeyFrom([{ fields: { boardCat: { value: v } } }], scope)).toBe(0);
    }
  });

  it("falls back to the plain count when no field scopes anything", () => {
    // A grid with no find-mode dropdowns must not get a key frozen at 0, which
    // would stop every pool refreshing for ever.
    expect(poolKeyFrom([{}, {}, {}], new Set())).toBe(3);
    expect(poolKeyFrom([{}, {}], null)).toBe(2);
  });
});
