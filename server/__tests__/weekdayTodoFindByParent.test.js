import { describe, it, expect } from "vitest";
import { planTodoFindFix } from "../migrations/0267-weekday-todo-find-by-parent.mjs";

const ancestorRule = { id: "r1", left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$dayColId" };
const markerRule = { id: "r2", left: "fields.TS.value", comparator: "IS", right: "Todo" };
const todoFind = (rules) => ({ id: "s", config: { type: "FIND", itemIdVar: "$todoId", predicate: { operator: "AND", rules } } });
const nest = (inner) => [{ id: "l", type: "loop", body: [{ id: "i", type: "if", then: [inner] }] }];

describe("planTodoFindFix", () => {
  it("rewrites the ancestor rule to a direct parentId test, nested arbitrarily deep", () => {
    const { patched } = planTodoFindFix(nest(todoFind([ancestorRule, markerRule])));
    const rules = patched[0].body[0].then[0].config.predicate.rules;
    expect(rules[0]).toMatchObject({ left: "parentId", comparator: "IS", right: "$dayColId" });
    // The marker rule is untouched — it is what makes the FIND find a TODO.
    expect(rules[1]).toEqual(markerRule);
  });

  it("is a no-op the second time — a re-run must not churn the pipeline", () => {
    const once = planTodoFindFix(nest(todoFind([ancestorRule, markerRule]))).patched;
    const twice = planTodoFindFix(once);
    expect(twice.patched).toBeNull();
    expect(twice.reason).toMatch(/already keyed on parentId/);
  });

  it("REFUSES when there is no $todoId FIND rather than guessing at another step", () => {
    const other = { id: "s", config: { type: "FIND", itemIdVar: "$wdSlotId", predicate: { rules: [ancestorRule] } } };
    const out = planTodoFindFix([other]);
    expect(out.patched).toBeNull();
    expect(out.reason).toMatch(/refusing/);
  });

  it("LEAVES the sibling slot FIND alone — the control", () => {
    // `$wdSlotId` already keys on parentId and is not this migration's business.
    // Without this, a rule that rewrote every ancestor test would pass above.
    const slot = { id: "s2", config: { type: "FIND", itemIdVar: "$wdSlotId",
      predicate: { rules: [{ id: "x", left: "parentId", comparator: "IS", right: "$dayColId" }] } } };
    const { patched } = planTodoFindFix([slot, todoFind([ancestorRule, markerRule])]);
    expect(patched[0].config.predicate.rules[0]).toMatchObject({ left: "parentId" });
    expect(patched[1].config.predicate.rules[0]).toMatchObject({ left: "parentId", right: "$dayColId" });
  });

  it("refuses an unfamiliar shape rather than rewriting something it does not understand", () => {
    const odd = todoFind([{ id: "z", left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$somethingElse" }]);
    const out = planTodoFindFix([odd]);
    expect(out.patched).toBeNull();
    expect(out.reason).toMatch(/not in the shape/);
  });

  it("does not mutate the input", () => {
    const input = nest(todoFind([ancestorRule, markerRule]));
    planTodoFindFix(input);
    expect(input[0].body[0].then[0].config.predicate.rules[0].left).toBe("_ancestors");
  });
});
