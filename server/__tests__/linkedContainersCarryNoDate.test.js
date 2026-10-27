import { describe, it, expect } from "vitest";
import { planClears, filterFieldIdsOf } from "../migrations/0445-linked-containers-carry-no-date.mjs";

const role = (m) => ({ slot: "container", row: "instance" }[m]);
const F = new Set(["date"]);
const o = (id, mod, lg, date) => ({ id, moduleId: mod, linkedGroupId: lg, fields: { date: { value: date } } });

describe("0445 planClears", () => {
  it("clears a date off linked containers only", () => {
    const plan = planClears([o("s1", "slot", "g", "2026-08-18"), o("s2", "slot", "g", null), o("r1", "row", "h", "2026-10-26"), o("r2", "row", "h", "2026-10-02")], role, F);
    expect(plan.map((p) => p.id)).toEqual(["s1"]);
  });
  it("a lone group member is not a copy-link and is left", () => {
    expect(planClears([o("s1", "slot", "solo", "2026-08-18")], role, F)).toEqual([]);
  });
  it("reads the filter fields off the grid", () => {
    expect([...filterFieldIdsOf({ activeFilterValues: { a: 1 }, namedFilters: [{ conditions: [{ fieldId: "b" }] }] })]).toEqual(["a", "b"]);
  });
});
