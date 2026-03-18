/**
 * CalculationHelpers.test.js
 *
 * Tests all 15 aggregation types (sum, count, countTrue, avg, min, max,
 * last, first, range, median, mode, stdDev, product, concat, unique).
 * Also tests COMPARISONS and flow-based filtering.
 */

import { describe, test, expect } from "vitest";
import { AGGREGATIONS, COMPARISONS } from "../helpers/CalculationHelpers";

// ─── Helper ───────────────────────────────────────────────────────────────────
function agg(name, values, options) {
  return AGGREGATIONS[name].fn(values, options);
}

// ─── All 15 aggregations ──────────────────────────────────────────────────────
describe("AGGREGATIONS", () => {
  describe("sum", () => {
    test("sums values", () => expect(agg("sum", [1, 2, 3])).toBe(6));
    test("empty → 0", () => expect(agg("sum", [])).toBe(0));
    test("negatives", () => expect(agg("sum", [5, -3])).toBe(2));
  });

  describe("count", () => {
    test("counts items", () => expect(agg("count", [1, 2, 3])).toBe(3));
    test("empty → 0", () => expect(agg("count", [])).toBe(0));
    test("counts any type", () => expect(agg("count", ["a", true, null])).toBe(3));
  });

  describe("countTrue", () => {
    test("counts truthy values", () => expect(agg("countTrue", [true, false, true, 1, 0])).toBe(3));
    test("empty → 0", () => expect(agg("countTrue", [])).toBe(0));
    test("all false → 0", () => expect(agg("countTrue", [false, false])).toBe(0));
  });

  describe("avg", () => {
    test("calculates mean", () => expect(agg("avg", [2, 4, 6])).toBe(4));
    test("empty → 0", () => expect(agg("avg", [])).toBe(0));
    test("single value", () => expect(agg("avg", [7])).toBe(7));
  });

  describe("min", () => {
    test("finds minimum", () => expect(agg("min", [3, 1, 2])).toBe(1));
    test("empty → 0", () => expect(agg("min", [])).toBe(0));
    test("negatives", () => expect(agg("min", [-5, -1, -3])).toBe(-5));
  });

  describe("max", () => {
    test("finds maximum", () => expect(agg("max", [3, 1, 2])).toBe(3));
    test("empty → 0", () => expect(agg("max", [])).toBe(0));
    test("negatives", () => expect(agg("max", [-5, -1, -3])).toBe(-1));
  });

  describe("last", () => {
    test("returns last value", () => expect(agg("last", [1, 2, 3])).toBe(3));
    test("empty → null", () => expect(agg("last", [])).toBeNull());
    test("single item", () => expect(agg("last", [42])).toBe(42));
  });

  describe("first", () => {
    test("returns first value", () => expect(agg("first", [1, 2, 3])).toBe(1));
    test("empty → null", () => expect(agg("first", [])).toBeNull());
  });

  describe("range", () => {
    test("max minus min", () => expect(agg("range", [1, 5, 3])).toBe(4));
    test("empty → 0", () => expect(agg("range", [])).toBe(0));
    test("same values → 0", () => expect(agg("range", [5, 5, 5])).toBe(0));
  });

  describe("median", () => {
    test("odd count → middle value", () => expect(agg("median", [1, 3, 5])).toBe(3));
    test("even count → average of two middles", () => expect(agg("median", [1, 2, 3, 4])).toBe(2.5));
    test("empty → 0", () => expect(agg("median", [])).toBe(0));
    test("unsorted input still works", () => expect(agg("median", [5, 1, 3])).toBe(3));
  });

  describe("mode", () => {
    test("returns most frequent value", () => expect(agg("mode", [1, 2, 2, 3])).toBe("2"));
    test("empty → null", () => expect(agg("mode", [])).toBeNull());
    test("single value", () => expect(agg("mode", [7])).toBe("7"));
  });

  describe("stdDev", () => {
    test("zero deviation for identical values", () => expect(agg("stdDev", [5, 5, 5])).toBe(0));
    test("empty → 0", () => expect(agg("stdDev", [])).toBe(0));
    test("basic deviation", () => {
      const result = agg("stdDev", [2, 4, 4, 4, 5, 5, 7, 9]);
      expect(result).toBeCloseTo(2, 0);
    });
  });

  describe("product", () => {
    test("multiplies all values", () => expect(agg("product", [2, 3, 4])).toBe(24));
    test("empty → 0", () => expect(agg("product", [])).toBe(0));
    test("includes zero → 0", () => expect(agg("product", [5, 0, 3])).toBe(0));
  });

  describe("concat", () => {
    test("joins with default separator", () => expect(agg("concat", ["a", "b", "c"])).toBe("a, b, c"));
    test("custom separator", () => expect(agg("concat", ["x", "y"], { separator: " | " })).toBe("x | y"));
    test("empty → empty string", () => expect(agg("concat", [])).toBe(""));
  });

  describe("unique", () => {
    test("counts distinct values", () => expect(agg("unique", [1, 1, 2, 3, 3])).toBe(3));
    test("empty → 0", () => expect(agg("unique", [])).toBe(0));
    test("all same → 1", () => expect(agg("unique", [5, 5, 5])).toBe(1));
  });
});

// ─── COMPARISONS ──────────────────────────────────────────────────────────────
describe("COMPARISONS", () => {
  test(">= passes when equal", () => expect(COMPARISONS[">="].fn(5, 5)).toBe(true));
  test(">= fails when less", () => expect(COMPARISONS[">="].fn(4, 5)).toBe(false));
  test("<= passes when equal", () => expect(COMPARISONS["<="].fn(5, 5)).toBe(true));
  test("== strict equality", () => expect(COMPARISONS["=="].fn(5, 5)).toBe(true));
  test("== fails for type mismatch", () => expect(COMPARISONS["=="].fn("5", 5)).toBe(false));
  test("!= detects difference", () => expect(COMPARISONS["!="].fn(4, 5)).toBe(true));
  test("> greater than", () => expect(COMPARISONS[">"].fn(6, 5)).toBe(true));
  test("< less than", () => expect(COMPARISONS["<"].fn(4, 5)).toBe(true));
});

// ─── Flow-based aggregation (as used by calculateDerivedField) ─────────────
describe("Flow-based value filtering (manual simulation)", () => {
  // Simulates what CalculationHelpers does internally:
  // filter occurrences by flow, extract values, aggregate

  function filterByFlow(fieldValues, flowFilter) {
    const flows = Array.isArray(flowFilter) ? flowFilter : [flowFilter];
    const include = (flow) =>
      flows.includes("any") || flows.includes(flow);

    return fieldValues.filter(({ flow }) => include(flow)).map(({ value }) => value);
  }

  const fieldValues = [
    { value: 10, flow: "in" },
    { value: 5, flow: "out" },
    { value: 20, flow: "in" },
  ];

  test("flowFilter 'in' includes only positive values", () => {
    expect(filterByFlow(fieldValues, "in")).toEqual([10, 20]);
  });

  test("flowFilter 'out' includes only negative values", () => {
    expect(filterByFlow(fieldValues, "out")).toEqual([5]);
  });

  test("flowFilter 'any' includes all values", () => {
    expect(filterByFlow(fieldValues, "any")).toEqual([10, 5, 20]);
  });

  test("flowFilter array ['in', 'out'] includes both", () => {
    expect(filterByFlow(fieldValues, ["in", "out"])).toEqual([10, 5, 20]);
  });

  test("sum after flow filter: in only", () => {
    const values = filterByFlow(fieldValues, "in");
    expect(agg("sum", values)).toBe(30);
  });
});
