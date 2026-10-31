// A dropdown's options can depend on the row being edited (user, 2026-10-31: "select a tv show, and then the
// episode field … only uses those episodes in the dropdown"): a record rule's left may be `$this…`, and
// SHARES_ANY compares two lists.
import { describe, it, expect } from "vitest";
import { evalRule, evalGroupAgainstRecord } from "../helpers/operationActions";
import { COMPARATOR_VALUES } from "../helpers/comparators";

const SHOW = "fShow", SERIES = "fSeries";
// "everything until a show is picked, then only that show's episodes"
const predicate = { operator: "OR", rules: [
  { left: `$this.fields.${SHOW}.value`, comparator: "IS_EMPTY", right: "" },
  { left: `fields.${SERIES}.value`, comparator: "SHARES_ANY", right: `$this.fields.${SHOW}.value` },
] };
const ep = (show) => ({ id: `e-${show}`, fields: { [SERIES]: { value: [show] } } });
const row = (shows) => ({ id: "watch", fields: shows ? { [SHOW]: { value: shows } } : {} });

describe("dependent dropdown options", () => {
  it("with no show picked, every episode is offered", () => {
    expect(evalGroupAgainstRecord(predicate, ep("a"), { $this: row(null) })).toBe(true);
    expect(evalGroupAgainstRecord(predicate, ep("b"), { $this: row([]) })).toBe(true);
  });
  it("with a show picked, only its episodes", () => {
    expect(evalGroupAgainstRecord(predicate, ep("a"), { $this: row(["a"]) })).toBe(true);
    expect(evalGroupAgainstRecord(predicate, ep("b"), { $this: row(["a"]) })).toBe(false);
  });
  it("several shows picked offers each one's episodes", () => {
    expect(evalGroupAgainstRecord(predicate, ep("b"), { $this: row(["a", "b"]) })).toBe(true);
  });
  it("$item. / $record. lefts stay record paths", () => {
    const r = { label: "x" };
    expect(evalGroupAgainstRecord({ rules: [{ left: "$item.label", comparator: "IS", right: "x" }] }, r, {})).toBe(true);
  });
  it("SHARES_ANY: one value or a list either side, empty shares nothing", () => {
    const sa = (l, r) => evalRule({ left: "$l", comparator: "SHARES_ANY", right: "$r" }, { $l: l, $r: r });
    expect(sa(["a", "b"], ["c", "b"])).toBe(true);
    expect(sa("a", ["a"])).toBe(true);
    expect(sa(["a"], "a")).toBe(true);
    expect(sa(["a"], ["c"])).toBe(false);
    expect(sa([], ["a"])).toBe(false);
    expect(sa(["a"], null)).toBe(false);
  });
  it("is offered in the comparator list", () => {
    expect(COMPARATOR_VALUES.has("SHARES_ANY")).toBe(true);
  });
});
