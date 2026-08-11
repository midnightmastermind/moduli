// 0069 narrows a guard on a SHARED op that governs every date-carrying page on
// the grid, so the tests weigh what it refuses and where it inserts.
import { describe, it, expect } from "vitest";
import { narrowSnapGuard } from "../migrations/0069-snap-filter-skips-cleared-dates.mjs";

const FID = "Eh7oi4HKdbHB";
const guardRule = () => ({ id: "g", left: `$pg.filterOverride.${FID}`, comparator: "IS_NOT_EMPTY", right: "" });
const op = () => ({ pipeline: { steps: [
  { id: "if1", type: "if", condition: { operator: "AND", rules: [{ id: "x", left: "$marker", comparator: "SAME_DAY", right: "$today" }] },
    then: [], else: [
      { id: "loop", type: "loop", body: [
        { id: "if2", type: "if", condition: { operator: "AND", rules: [guardRule()] }, then: [], else: [] },
      ]},
    ]},
]}});

const orGroup = (o) => o.pipeline.steps[0].else[0].body[0].condition.rules.find((r) => Array.isArray(r.rules));

describe("0069 narrowSnapGuard", () => {
  it("inserts the OR group directly after the guard it narrows", () => {
    const o = op();
    const r = narrowSnapGuard(o);
    expect(r.patched).toBe(1);
    expect(r.path).toBe(`$pg.filterOverride.${FID}`);
    const rules = o.pipeline.steps[0].else[0].body[0].condition.rules;
    expect(rules[0].comparator).toBe("IS_NOT_EMPTY");
    expect(Array.isArray(rules[1].rules)).toBe(true);
  });

  // Each arm exists for a shape that is live on the grid; losing one silently
  // changes which pages move forward.
  it("carries all three arms — value, bare-string (unit empty), and multi dates", () => {
    const o = op(); narrowSnapGuard(o);
    const arms = orGroup(o).rules.map((x) => `${x.left.split(".").pop()}:${x.comparator}`);
    expect(arms).toEqual(["value:IS_NOT_EMPTY", "unit:IS_EMPTY", "dates:IS_NOT_EMPTY"]);
  });

  it("is idempotent — a second run adds nothing", () => {
    const o = op(); narrowSnapGuard(o);
    const before = JSON.stringify(o.pipeline);
    const r = narrowSnapGuard(o);
    expect(r.patched).toBe(0);
    expect(r.alreadyNarrowed).toBe(1);
    expect(JSON.stringify(o.pipeline)).toBe(before);
  });

  it("fails CLOSED when there is no such guard to narrow", () => {
    const o = { pipeline: { steps: [{ id: "if", type: "if", condition: { operator: "AND", rules: [
      { id: "z", left: "$something.else", comparator: "IS_NOT_EMPTY", right: "" },
    ]}, then: [], else: [] }]}};
    const r = narrowSnapGuard(o);
    expect(r.patched).toBe(0);
    expect(r.reason).toMatch(/no .*guard found/i);
  });

  it("does not mistake a DIFFERENT filterOverride comparator for the guard", () => {
    const o = { pipeline: { steps: [{ id: "if", type: "if", condition: { operator: "AND", rules: [
      { id: "z", left: `$pg.filterOverride.${FID}`, comparator: "IS", right: "2026-08-10" },
    ]}, then: [], else: [] }]}};
    expect(narrowSnapGuard(o).reason).toBeTruthy();
  });

  it("fails CLOSED on an op with no pipeline", () => {
    expect(narrowSnapGuard({}).reason).toBeTruthy();
  });
});
