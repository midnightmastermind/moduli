// The tracker date-filter audit's fixes. 24 of 30 tracker ops already gate on
// `$goalPeriod` from their tile's `_effectiveFilter`; these three did not.
//
// The load-bearing distinction: the healthy 24 gate a LOOP and fail OPEN
// (`$goalPeriod IS_EMPTY` counts everything). The two workout trackers FIND a
// single day column, and a FIND that matches several rows binds an ARRAY that
// UPDATE throws on (2026-08-11 (4)) — so their fallback is `SAME_DAY $today`,
// never "match anything".
import { describe, it, expect } from "vitest";
import { periodOrUnfiltered, periodOrToday, bindPeriod, replaceTodayRule, gateLoop }
  from "../migrations/0196-three-trackers-follow-the-page-filter.mjs";

const D = "Eh7oi4HKdbHB";
// The fixtures carry `type: "action"` because every STORED step does, and a
// step without it is skipped by the executor. Building them the loose way is
// what let the first version of this suite pass against an inert migration.
const findPipeline = () => ({ steps: [
  { id: "s0", type: "action", config: { type: "INIT_VAR", name: "$tile", expr: "$allItemsById.T1" } },
  { id: "s1", type: "action", config: { type: "FIND", over: "$allContainers" }, condition: { operator: "AND", rules: [
    { id: "a", left: "fields.SF.value", comparator: "IS", right: "day-col" },
    { id: "b", left: `fields.${D}.value`, comparator: "SAME_DAY", right: "$today" },
  ] } },
] });
const loopPipeline = () => ({ steps: [
  { id: "s0", type: "action", config: { type: "INIT_VAR", name: "$tile", expr: "$allItemsById.T1" } },
  { id: "s1", type: "action", config: { type: "LOOP" }, condition: { operator: "AND", rules: [
    { id: "a", left: "$item._ancestors", comparator: "HAS_ANCESTOR", right: "SCHED" },
    { id: "b", left: "$item.fields.DONE.value", comparator: "IS", right: true },
  ] }, body: [] },
] });

describe("the two rule shapes differ, and that is the point", () => {
  it("the LOOP gate fails OPEN — no filter counts everything", () => {
    const r = periodOrUnfiltered();
    expect(r.operator).toBe("OR");
    expect(r.rules[1]).toMatchObject({ left: "$goalPeriod", comparator: "IS_EMPTY" });
  });

  it("the FIND gate falls back to TODAY, never to everything", () => {
    // An IS_EMPTY arm here would match every day column; the FIND would bind an
    // array and UPDATE would throw. This is the whole reason the two shapes are
    // not one helper.
    const r = periodOrToday();
    const fallback = r.rules[1];
    expect(fallback.operator).toBe("AND");
    expect(fallback.rules.map(x => x.comparator).sort()).toEqual(["IS_EMPTY", "SAME_DAY"]);
    expect(JSON.stringify(r)).not.toMatch(/"IS_EMPTY"[^}]*}\s*\]\s*}$/);
  });

  it("the LOOP gate reads $item, the FIND gate reads the record — the paths differ", () => {
    expect(periodOrUnfiltered().rules[0].left).toBe(`$item.fields.${D}.value`);
    expect(periodOrToday().rules[0].left).toBe(`fields.${D}.value`);
  });
});

describe("bindPeriod", () => {
  it("inserts the INIT_VAR immediately after the tile binding", () => {
    const p = findPipeline();
    expect(bindPeriod(p, "$tile")).toBe(1);
    expect(p.steps[1].config).toMatchObject({
      type: "INIT_VAR", name: "$goalPeriod", expr: `$tile._effectiveFilter.${D}` });
  });

  it("stamps `type: \"action\"` on the step — without it the executor SKIPS it", () => {
    // The defect this migration shipped once: every stored step is
    // `{ id, type: "action", config }`, and a step missing `type` is skipped
    // silently, with no log entry. The pipeline reads correctly, the migration
    // reports success, and the variable never exists — so every gate falls
    // through its fail-open arm and nothing changes. Structural tests all
    // passed; only the executor's run log showed the step was never run.
    const p = findPipeline();
    bindPeriod(p, "$tile");
    expect(p.steps[1].type).toBe("action");
    expect(p.steps[1].type).toBe(p.steps[0].type);   // same shape as its neighbours
  });

  it("REPAIRS an inert $goalPeriod step left by the first apply", () => {
    const p = findPipeline();
    p.steps.splice(1, 0, { id: "x", config: { type: "INIT_VAR", name: "$goalPeriod", expr: "$tile._effectiveFilter.X" } });
    expect(bindPeriod(p, "$tile")).toBe(1);
    expect(p.steps[1].type).toBe("action");
    expect(p.steps.filter(s => s.config?.name === "$goalPeriod")).toHaveLength(1);  // repaired, not duplicated
  });

  it("is idempotent — a pipeline already binding it RUNNABLY is untouched", () => {
    const p = findPipeline();
    bindPeriod(p, "$tile");
    const before = JSON.stringify(p);
    expect(bindPeriod(p, "$tile")).toBe(0);
    expect(JSON.stringify(p)).toBe(before);
  });

  it("REFUSES when the named tile var is not bound — no guessing", () => {
    const p = findPipeline();
    expect(bindPeriod(p, "$nosuchvar")).toBe(0);
    expect(JSON.stringify(p)).not.toContain("$goalPeriod");
  });
});

describe("replaceTodayRule", () => {
  it("swaps the wall-clock rule and leaves its siblings alone", () => {
    const p = findPipeline();
    expect(replaceTodayRule(p, periodOrToday())).toBe(1);
    const rules = p.steps[1].condition.rules;
    expect(rules[0]).toMatchObject({ left: "fields.SF.value", right: "day-col" });  // sibling intact
    expect(JSON.stringify(rules[1])).toContain("DATE_IN_PERIOD");
    // The replacement legitimately CONTAINS a `SAME_DAY $today` — that is its
    // fallback arm. The real claim is that it is no longer a TOP-LEVEL rule:
    // unconditional before, reachable only when no filter is set after.
    expect(rules.some(r => r.comparator === "SAME_DAY")).toBe(false);
  });

  it("finds the rule nested inside a branch", () => {
    const p = { steps: [{ id: "b", type: "action", config: { type: "IF" }, then: [findPipeline().steps[1]] }] };
    expect(replaceTodayRule(p, periodOrToday())).toBe(1);
  });

  it("reports 0 when there is no such rule — the caller SKIPS rather than writing", () => {
    const p = loopPipeline();
    expect(replaceTodayRule(p, periodOrToday())).toBe(0);
  });
});

describe("gateLoop", () => {
  it("appends the gate to the ancestor-scoped condition", () => {
    const p = loopPipeline();
    expect(gateLoop(p, periodOrUnfiltered())).toBe(1);
    const rules = p.steps[1].condition.rules;
    expect(rules).toHaveLength(3);
    expect(rules[0].comparator).toBe("HAS_ANCESTOR");   // existing rules kept, in order
    expect(rules[1].comparator).toBe("IS");
    expect(JSON.stringify(rules[2])).toContain("$goalPeriod");
  });

  it("gates only the FIRST ancestor-scoped group, not every group", () => {
    const p = loopPipeline();
    p.steps.push(JSON.parse(JSON.stringify(p.steps[1])));
    expect(gateLoop(p, periodOrUnfiltered())).toBe(1);
    expect(p.steps[2].condition.rules).toHaveLength(2);
  });

  it("does nothing when no group scopes on an ancestor — the control", () => {
    const p = findPipeline();
    expect(gateLoop(p, periodOrUnfiltered())).toBe(0);
  });
});
