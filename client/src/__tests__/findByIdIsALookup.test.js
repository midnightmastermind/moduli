// A FIND whose whole condition is `id IS <x>` must not walk the collection:
// `Project: Stamp Status From Column` did, costing 65-80ms of every instance
// create and move on the live grid (prod profile, 2026-09-19).
import { describe, it, expect, vi } from "vitest";
import { executeActionItem, singleIdEquals, idIndexFor } from "../helpers/operationActions";

const ctx = () => ({ occurrencesById: {}, modulesById: {}, fieldsById: {}, state: {} });
const rule = (left, comparator, right) => ({ left, comparator, right });

describe("singleIdEquals", () => {
  it("recognises the lookup shape, with or without a record prefix", () => {
    expect(singleIdEquals({ rules: [rule("id", "IS", "$x")] }, { $x: "occ1" })).toBe("occ1");
    expect(singleIdEquals({ rules: [rule("$item.id", "IS", "occ2")] }, {})).toBe("occ2");
  });
  // THE CONTROLS: anything else must still scan.
  it("declines a second rule, another comparator, another field, a nested group", () => {
    expect(singleIdEquals({ rules: [rule("id", "IS", "a"), rule("label", "IS", "b")] }, {})).toBeNull();
    expect(singleIdEquals({ rules: [rule("id", "IS_NOT", "a")] }, {})).toBeNull();
    expect(singleIdEquals({ rules: [rule("label", "IS", "a")] }, {})).toBeNull();
    expect(singleIdEquals({ rules: [{ rules: [rule("id", "IS", "a")] }] }, {})).toBeNull();
    expect(singleIdEquals({ rules: [rule("id", "IS", "$missing")] }, {})).toBeNull();
  });
});

describe("FIND by id", () => {
  const list = [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C", deleted: true },
    { id: "t", label: "T", meta: { isTemplate: true } }];

  const run = (predicate, $vars = {}) => {
    const vars = { $all: list, ...$vars };
    executeActionItem("FIND", { over: "$all", predicate, itemVar: "$hit", itemIdVar: "$hitId" }, vars, ctx(), null);
    return vars;
  };

  it("finds the record without scanning", () => {
    const spy = vi.spyOn(Array.prototype, "filter");
    const v = run({ rules: [rule("id", "IS", "b")] });
    expect(v.$hit.label).toBe("B");
    expect(v.$hitId).toBe("b");
    spy.mockRestore();
  });

  // Same exclusions as the scan: deleted rows and templates are not matches.
  it("still refuses a deleted record and a template", () => {
    expect(run({ rules: [rule("id", "IS", "c")] }).$hit).toBeNull();
    expect(run({ rules: [rule("id", "IS", "t")] }).$hit).toBeNull();
  });

  it("returns null for an id that is not there", () => {
    expect(run({ rules: [rule("id", "IS", "zzz")] }).$hit).toBeNull();
  });

  // The fallback path must still work identically.
  it("a non-id predicate still scans and matches", () => {
    expect(run({ operator: "AND", rules: [rule("label", "IS", "A")] }).$hitId).toBe("a");
  });

  it("indexes per array identity, and a replaced array re-indexes", () => {
    const i1 = idIndexFor(list), i2 = idIndexFor(list);
    expect(i1).toBe(i2);
    expect(idIndexFor([...list, { id: "d" }]).get("d")).toBeTruthy();
  });
});
