// 0213 — the guard that stops `Schedule: Fill Day` scanning 1347 containers for
// slots it has nothing to put in.
import { describe, it, expect } from "vitest";
import { planFillDayGuard } from "../migrations/0213-fill-day-stops-scanning-for-slots-it-has-nothing-to-put-in.mjs";

const targetIf = (then = []) => ({
  id: "guard",
  type: "if",
  condition: { operator: "AND", rules: [{ id: "u92", left: "$tSlotTime", comparator: "IS_NOT_EMPTY", right: "" }] },
  then,
});

// The real shape: the guard wraps a FIND, and under it a LOOP over the SAME
// expression the new rule tests. That is what makes the change inert.
const realPipeline = () => ({
  steps: [
    { id: "a", type: "action", config: { type: "INIT_VAR", name: "$schedPage" } },
    {
      id: "dayloop", type: "loop", overExpr: "$activePeriodDates", as: "$day",
      steps: [
        { id: "f1", type: "action", config: { type: "FIND", over: "$allContainers", itemIdVar: "$dayColId" } },
        {
          id: "tplloop", type: "loop", overExpr: "$stPage.occurrences", as: "$wdTplId",
          steps: [{
            id: "slotloop", type: "loop", overExpr: "$wdTpl.occurrences", as: "$tSlotId",
            steps: [targetIf([
              { id: "f2", type: "action", config: { type: "FIND", over: "$allContainers", itemIdVar: "$daySlotId" } },
              { id: "itemloop", type: "loop", overExpr: "$tSlot.occurrences", as: "$tItemId", steps: [] },
            ])],
          }],
        },
      ],
    },
  ],
});

const findGuard = (p) => {
  let found = null;
  const walk = (steps) => {
    for (const s of steps || []) {
      if (s?.id === "guard") found = s;
      for (const k of ["steps", "body", "then", "else"]) if (Array.isArray(s?.[k])) walk(s[k]);
    }
  };
  walk(p.steps);
  return found;
};

describe("planFillDayGuard", () => {
  it("adds the slot-has-items rule to the $tSlotTime guard", () => {
    const { pipeline, added } = planFillDayGuard(realPipeline());
    expect(added).toBe(1);
    const rules = findGuard(pipeline).condition.rules;
    expect(rules).toHaveLength(2);
    expect(rules[0].left).toBe("$tSlotTime");            // the original is kept
    expect(rules[1]).toMatchObject({ left: "$tSlot.occurrences", comparator: "IS_NOT_EMPTY" });
    expect(findGuard(pipeline).condition.operator).toBe("AND");
  });

  // THE PROPERTY THAT MAKES IT SAFE: the rule tests the SAME expression the
  // innermost loop iterates, so it can never skip a slot the loop would fill.
  it("guards on exactly the expression the innermost loop iterates", () => {
    const { pipeline } = planFillDayGuard(realPipeline());
    const guard = findGuard(pipeline);
    const loop = guard.then.find((s) => s.type === "loop");
    const newRule = guard.condition.rules.find((r) => r.left === "$tSlot.occurrences");
    expect(newRule.left).toBe(loop.overExpr);
  });

  it("is idempotent — a second pass adds nothing", () => {
    const once = planFillDayGuard(realPipeline());
    const twice = planFillDayGuard(once.pipeline);
    expect(twice.added).toBe(0);
    expect(findGuard(twice.pipeline).condition.rules).toHaveLength(2);
  });

  it("does not mutate the input pipeline", () => {
    const input = realPipeline();
    const before = JSON.stringify(input);
    planFillDayGuard(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  // THE 0035 CLASS: a selector that matches more than it names. These are all
  // conditions the migration must LEAVE ALONE.
  it("ignores IFs that are not exactly the single $tSlotTime rule", () => {
    const decoys = {
      steps: [
        // two rules — a different guard that happens to mention $tSlotTime
        { id: "d1", type: "if", condition: { operator: "AND", rules: [
          { left: "$tSlotTime", comparator: "IS_NOT_EMPTY", right: "" },
          { left: "$other", comparator: "IS", right: "x" }] }, then: [] },
        // right variable, wrong comparator
        { id: "d2", type: "if", condition: { operator: "AND", rules: [
          { left: "$tSlotTime", comparator: "IS_EMPTY", right: "" }] }, then: [] },
        // a similarly-named variable — must not be prefix-matched
        { id: "d3", type: "if", condition: { operator: "AND", rules: [
          { left: "$tSlotTimeZone", comparator: "IS_NOT_EMPTY", right: "" }] }, then: [] },
        // no condition at all
        { id: "d4", type: "loop", overExpr: "$x", as: "$y", steps: [] },
      ],
    };
    const { added, pipeline } = planFillDayGuard(decoys);
    expect(added).toBe(0);
    for (const s of pipeline.steps) {
      if (s.condition) expect(s.condition.rules.some((r) => r.left === "$tSlot.occurrences")).toBe(false);
    }
  });

  it("is null-safe on a missing or empty pipeline", () => {
    expect(planFillDayGuard(null).added).toBe(0);
    expect(planFillDayGuard({}).added).toBe(0);
    expect(planFillDayGuard({ steps: [] }).added).toBe(0);
  });
});
