import { describe, it, expect } from "vitest";
import { plannedSource, SCHEDULE_FORMAT_VALUES } from "../migrations/0423-manual-options-under-values.mjs";

const f = (name, src) => ({ name, meta: { optionsSource: src } });

describe("0423 manual options under values", () => {
  it("moves a stored list across unchanged", () => {
    const next = plannedSource(f("Cadence", { mode: "manual", options: ["weekly", "monthly"] }));
    expect(next).toEqual({ mode: "manual", values: ["weekly", "monthly"] });
    expect("options" in next).toBe(false);
  });
  it("gives Schedule Format the values the field actually holds", () => {
    expect(plannedSource(f("Schedule Format", { mode: "manual", options: ["timeslot", "shortened"] })).values).toEqual(SCHEDULE_FORMAT_VALUES);
    expect(SCHEDULE_FORMAT_VALUES).toEqual(expect.arrayContaining(["slot", "day-col"]));
  });
  it("keeps a values list that is already there", () => {
    expect(plannedSource(f("X", { mode: "manual", values: ["a"], options: ["b"] })).values).toEqual(["a"]);
  });
  it("leaves fields with nothing to move", () => {
    expect(plannedSource(f("X", { mode: "manual", values: ["a"] }))).toBeNull();
    expect(plannedSource(f("X", { mode: "find", options: ["a"] }))).toBeNull();
  });
});
