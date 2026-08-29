// The grid states what it filters on; this file only reads it.
import { describe, it, expect } from "vitest";
import { filterFieldIdsOf, withoutFilterFields } from "../utils/filterFields.js";

describe("filterFieldIdsOf", () => {
  it("reads activeFilterValues AND every namedFilter condition", () => {
    const ids = filterFieldIdsOf({
      activeFilterValues: { dateF: "2026-08-29" },
      namedFilters: [
        { conditions: [{ fieldId: "tagsF" }, { fieldId: "dateF" }] },
        { conditions: [{ fieldId: "statusF" }] },
      ],
    });
    expect([...ids].sort()).toEqual(["dateF", "statusF", "tagsF"]);
  });

  it("survives a grid with no filters at all", () => {
    for (const g of [null, undefined, {}, { namedFilters: [{}] }, { namedFilters: [{ conditions: [{}] }] }]) {
      expect(filterFieldIdsOf(g).size).toBe(0);
    }
  });
});

describe("withoutFilterFields", () => {
  const fields = { dateF: { value: "2026-08-29" }, doneF: { value: true } };

  it("drops the filter field and keeps the rest", () => {
    const out = withoutFilterFields(fields, new Set(["dateF"]));
    expect(Object.keys(out)).toEqual(["doneF"]);
  });

  it("returns the ORIGINAL object when nothing was dropped", () => {
    // The common write touches no filter field; it should allocate nothing.
    expect(withoutFilterFields(fields, new Set(["otherF"]))).toBe(fields);
  });

  it("fails OPEN on an unknown or empty set", () => {
    expect(withoutFilterFields(fields, undefined)).toBe(fields);
    expect(withoutFilterFields(fields, new Set())).toBe(fields);
  });

  it("does not mutate the input", () => {
    const copy = JSON.parse(JSON.stringify(fields));
    withoutFilterFields(fields, new Set(["dateF"]));
    expect(fields).toEqual(copy);
  });

  it("returns an empty object when every field was a filter field", () => {
    // The caller uses this to skip the patch entirely rather than writing {}.
    expect(withoutFilterFields({ dateF: { value: 1 } }, new Set(["dateF"]))).toEqual({});
  });
});
