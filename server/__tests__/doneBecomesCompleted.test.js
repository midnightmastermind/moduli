import { describe, it, expect } from "vitest";
import { doneSectionFilters, fieldsWithoutDone, withoutFieldWrites, tasksAutoApplied } from "../migrations/0503-done-becomes-completed.mjs";

const ids = { doneId: "D", sinceId: "S", completedId: "C", completedOnId: "O", yesterday: "2026-11-15" };

describe("0503 — Done becomes Completed", () => {
  it("a row marked Done becomes Completed, Completed On = when it was marked; Done goes", () => {
    expect(fieldsWithoutDone({ D: { value: true }, S: { value: "2026-11-02" }, X: { value: 1 } }, ids))
      .toEqual({ C: { value: true, flow: "in" }, O: { value: "2026-11-02", flow: "in" }, X: { value: 1 } });
  });
  it("a row NOT marked Done stays unticked (user: keep it unchecked)", () => {
    expect(fieldsWithoutDone({ D: { value: false }, S: { value: "2026-11-16" } }, ids)).toEqual({});
  });
  it("an existing Completed On is kept; no Done Since falls back to yesterday (so it stays hidden)", () => {
    expect(fieldsWithoutDone({ D: { value: true }, C: { value: true }, O: { value: "2026-11-01" } }, ids)).toEqual({ C: { value: true }, O: { value: "2026-11-01" } });
    expect(fieldsWithoutDone({ D: { value: true } }, ids).O.value).toBe("2026-11-15");
  });
  it("a row without Done is not touched", () => expect(fieldsWithoutDone({ C: { value: true } }, ids)).toBe(null));
  it("the Done section keeps rows completed today or not at all", () => {
    const f = doneSectionFilters([{ id: "x", fieldId: "D", comparator: "IS" }, { id: "y", fieldId: "Z" }], ids);
    expect(f.map((x) => x.fieldId || "cond")).toEqual(["Z", "cond"]);
    expect(f[1].condition.operator).toBe("OR");
    expect(f[1].condition.rules.map((r) => r.comparator)).toEqual(["IS_EMPTY", "DATE_IS_TODAY", "DATE_AFTER_TODAY"]);
    expect(f[1]).toMatchObject({ active: true, hides: true });
    // re-running does not stack a second keep filter
    expect(doneSectionFilters(f, ids).filter((x) => x.condition)).toHaveLength(1);
  });
  it("only the steps writing Done / Done Since are removed, nested ones too", () => {
    const up = (fid) => ({ type: "action", config: { type: "UPDATE", path: `$task.fields.${fid}.value` } });
    const [p, n] = withoutFieldWrites({ steps: [{ type: "if", then: [up("S"), up("D"), up("K")] }, up("D")] }, ["D", "S"]);
    expect(n).toBe(3);
    expect(p.steps).toEqual([{ type: "if", then: [up("K")] }]);
  });
  it("the Tasks page carries the grid's list and adds Completed once", () => {
    expect(tasksAutoApplied(null, ["tags", "date"], "C")).toEqual(["tags", "date", "C"]);
    expect(tasksAutoApplied(["C"], ["tags"], "C")).toEqual(["C"]);
  });
});
