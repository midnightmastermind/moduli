import { describe, it, expect } from "vitest";
import { executeActionItem, sameDayRuleOf, recordsOnDay } from "../helpers/operationActions.js";

const rec = (id, date, extra = {}) => ({ id, moduleId: "m", fields: date === undefined ? {} : { d: { value: date } }, ...extra });
const list = [
  rec("a", "2026-10-21"),
  rec("b", "2026-10-22"),
  rec("c", "2026-10-21T15:00:00"),
  rec("d", undefined),
  rec("e", { weird: true }),
  rec("f", "2026-10-21"),
];

describe("FIND reads a day's records from an index", () => {
  it("recognises an AND condition's SAME_DAY rule on a field", () => {
    const p = { operator: "AND", rules: [{ left: "fields.d.value", comparator: "SAME_DAY", right: "$day" }] };
    expect(sameDayRuleOf(p, { $day: "2026-10-21" })).toEqual({ fieldId: "d", day: "2026-10-21" });
    expect(sameDayRuleOf({ ...p, operator: "OR" }, { $day: "2026-10-21" })).toBe(null);
    expect(sameDayRuleOf(p, { $day: "" })).toBe(null);
    expect(sameDayRuleOf(p, { $day: { value: "2026-10-21", unit: "week" } })).toBe(null);
  });

  it("keeps list order and keeps records whose value is not a plain date", () => {
    expect(recordsOnDay(list, "d", "2026-10-21").map((r) => r.id)).toEqual(["a", "c", "d", "e", "f"]);
  });

  it("finds exactly what the full scan finds", () => {
    const run = (predicate) => {
      const $vars = { $allOccurrences: list, $day: "2026-10-21" };
      executeActionItem("FIND", { predicate, itemIdVar: "$ids", multiple: true }, $vars, {}, {});
      return $vars.$ids;
    };
    const p = { operator: "AND", rules: [{ left: "fields.d.value", comparator: "SAME_DAY", right: "$day" }] };
    expect(run(p)).toEqual(["a", "c", "f"]);
    const p2 = { operator: "AND", rules: [...p.rules, { left: "id", comparator: "IS_NOT", right: "literal:a" }] };
    expect(run(p2)).toEqual(["c", "f"]);
  });
});
