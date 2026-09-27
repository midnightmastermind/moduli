// The catalog must not drift from the evaluator again.
//
// `evalRule` (helpers/operationActions.js) is the canonical evaluator; the
// catalog (helpers/comparators.js) is the canonical LIST. They were two
// hand-written literals plus a third in ConditionGroup.jsx, and by 2026-09-27
// 138 of 248 live operations used a comparator no editor could offer.
//
// The WALKER below is the load-bearing test: it reads `evalRule`'s own source
// and fails when the evaluator learns a comparator the catalog does not carry.
// A comparator that exists and cannot be picked is invisible, which is exactly
// how this happened.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  COMPARATOR_CATALOG,
  COMPARATOR_OPTIONS,
  COMPARATOR_VALUES,
  UNARY_COMPARATORS,
  PIPELINE_COMPARATOR_GROUPS,
} from "../helpers/comparators";
import { evalRule } from "../helpers/operationActions";

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "helpers", "operationActions.js"),
  "utf8"
);

/** Every comparator `evalRule` can answer, read out of its own body. Its switch
 *  cases plus the two `comparator === "…"` checks that run BEFORE the switch
 *  (IS_EMPTY / IS_NOT_EMPTY short-circuit there, so a case-only scan misses
 *  them and the walker would pass while two entries went unverified). */
function comparatorCases() {
  const start = SRC.indexOf("export function evalRule(");
  expect(start).toBeGreaterThan(-1);
  // evalRule ends at the `default: return false;` of its comparator switch —
  // the next `evalRule*` export begins the following function.
  const end = SRC.indexOf("export function evalRuleWithLeftValue(", start);
  expect(end).toBeGreaterThan(start);
  const body = SRC.slice(start, end);
  const out = new Set();
  for (const m of body.matchAll(/^\s*case "([A-Z_]+)":/gm)) out.add(m[1]);
  for (const m of body.matchAll(/comparator === "([A-Z_]+)"/g)) out.add(m[1]);
  return out;
}

describe("comparator catalog", () => {
  it("carries EVERY comparator evalRule implements", () => {
    const missing = [...comparatorCases()].filter((c) => !COMPARATOR_VALUES.has(c));
    expect(missing).toEqual([]);
  });

  it("lists nothing evalRule cannot answer", () => {
    const cases = comparatorCases();
    const extra = COMPARATOR_CATALOG.map((c) => c.value).filter((v) => !cases.has(v));
    expect(extra).toEqual([]);
  });

  it("found a real set of cases — the walker itself is not vacuous", () => {
    // A scan that silently matched nothing would make both tests above pass.
    const cases = comparatorCases();
    expect(cases.size).toBeGreaterThan(20);
    expect(cases.has("DATE_IN_PERIOD")).toBe(true);
    expect(cases.has("IS_EMPTY")).toBe(true);
  });

  it("offers the comparators that live operations actually depend on", () => {
    // These are the ones the editor could not author (DATE_IN_PERIOD alone is
    // 390 rules). A regression here is the original defect returning.
    const offered = new Set(
      PIPELINE_COMPARATOR_GROUPS.flatMap((g) => g.items.map((c) => c.value))
    );
    for (const c of [
      "DATE_IN_PERIOD",
      "DATE_ON_OR_BEFORE_PERIOD",
      "ARRAY_INCLUDES",
      "ARRAY_NOT_INCLUDES",
      "NOT_HAS_ANCESTOR",
      "DATE_BEFORE",
      "DATE_AFTER",
      "DATE_WITHIN_DAYS",
      "TIME_BEFORE",
      "TIME_AFTER",
    ]) {
      expect(offered.has(c), `${c} is not offered`).toBe(true);
    }
  });

  it("hides aliases from the picker but still accepts them", () => {
    // `GREATER_THAN` is a second spelling of `GREATER`; offering both would
    // present one comparator twice and make the choice look meaningful.
    const offered = new Set(
      PIPELINE_COMPARATOR_GROUPS.flatMap((g) => g.items.map((c) => c.value))
    );
    expect(offered.has("GREATER_THAN")).toBe(false);
    expect(COMPARATOR_VALUES.has("GREATER_THAN")).toBe(true);
    expect(evalRule({ left: 5, comparator: "GREATER_THAN", right: 1 }, {})).toBe(true);
  });

  it("keeps the simple-filter subset and its ORDER exactly as three live dropdowns show it", () => {
    // The grid named-filter editor, the table-column filter popover and the
    // feed-condition editor render this list. Deriving the order from the
    // catalog would silently re-sort all three.
    expect(COMPARATOR_OPTIONS.map((o) => o.value)).toEqual([
      "SAME_DAY", "SAME_WEEK", "SAME_MONTH", "SAME_YEAR",
      "IS", "IS_NOT", "CONTAINS", "SAME_TEXT", "GREATER", "LESS",
      "IS_EMPTY", "IS_NOT_EMPTY",
    ]);
    expect(COMPARATOR_OPTIONS.every((o) => o.label && o.value)).toBe(true);
  });

  it("marks as unary exactly the comparators that take no right operand", () => {
    // ConditionGroup's own no-right set omitted nothing, but comparators.js's
    // did — the two disagreed about the DATE_*_TODAY trio, and a value box on a
    // comparator that ignores it is a control that does nothing.
    expect([...UNARY_COMPARATORS].sort()).toEqual([
      "DATE_AFTER_TODAY", "DATE_BEFORE_TODAY", "DATE_IS_TODAY",
      "IS_EMPTY", "IS_NOT_EMPTY",
    ]);
    // Each answers with the right operand absent entirely.
    for (const c of UNARY_COMPARATORS) {
      expect(typeof evalRule({ left: "", comparator: c }, {})).toBe("boolean");
    }
  });

  it("gives every entry a group, a label and a unique value", () => {
    const seen = new Set();
    for (const c of COMPARATOR_CATALOG) {
      expect(c.group, `${c.value} has no group`).toBeTruthy();
      expect(c.label, `${c.value} has no label`).toBeTruthy();
      expect(seen.has(c.value), `${c.value} listed twice`).toBe(false);
      seen.add(c.value);
    }
  });
});
