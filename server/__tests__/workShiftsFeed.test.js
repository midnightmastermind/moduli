import { describe, it, expect } from "vitest";
import { withEmploymentBranch } from "../migrations/0409-work-shifts-feed.mjs";

const steps = [
  { id: "a", type: "action", config: { type: "INIT_VAR", name: "$stype", expr: "literal:APPT" } },
  { id: "b", type: "if", condition: { operator: "AND", rules: [{ left: "$share.props.destinationId", comparator: "IS", right: "HOLIDAYS" }] },
    then: [{ type: "action", config: { type: "SET_VAR", name: "$stype", expr: "literal:HOLIDAY" } }], else: [] },
  { id: "c", type: "loop", overExpr: "$share.events", as: "$e", body: [] },
];

describe("0409 withEmploymentBranch", () => {
  it("adds the Employment branch right after the Holiday one, before the loop that creates rows", () => {
    const out = withEmploymentBranch(steps, { workShiftsOccId: "WORK", employmentOccId: "EMP" });
    expect(out.map((s) => s.id).slice(0, 2)).toEqual(["a", "b"]);
    expect(out[2].condition.rules[0]).toMatchObject({ left: "$share.props.destinationId", comparator: "IS", right: "WORK" });
    expect(out[2].then[0].config).toEqual({ type: "SET_VAR", name: "$stype", expr: "literal:EMP" });
    expect(out[3].id).toBe("c");
  });
  it("is a no-op the second time", () => {
    const once = withEmploymentBranch(steps, { workShiftsOccId: "WORK", employmentOccId: "EMP" });
    expect(withEmploymentBranch(once, { workShiftsOccId: "WORK", employmentOccId: "EMP" })).toBe(null);
  });
  it("refuses a rule without the $stype branch", () => {
    expect(() => withEmploymentBranch([steps[2]], { workShiftsOccId: "W", employmentOccId: "E" })).toThrow(/Holiday branch/);
  });
});
