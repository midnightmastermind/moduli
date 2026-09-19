import { describe, it, expect } from "vitest";
import { excludeMoodRows } from "../migrations/0348-a-mood-check-in-is-not-a-completed-task.mjs";
const ids = { completedFieldId: "done", moodFieldId: "mood" };
const pipe = () => ({ steps: [{ type: "loop", body: [{ type: "if", condition: { operator: "AND", rules: [
  { left: "$item.fields.done.value", comparator: "IS", right: true },
  { left: "$item._ancestors", comparator: "HAS_ANCESTOR", right: "$scopePageId" },
] }, then: [], else: [] }] }] });
describe("0348 excludeMoodRows", () => {
  it("adds a no-Mood rule, with the same variable prefix, to a group testing Completed", () => {
    const { pipeline, groups } = excludeMoodRows(pipe(), ids);
    expect(groups).toBe(1);
    const rules = pipeline.steps[0].body[0].condition.rules;
    expect(rules.at(-1)).toMatchObject({ left: "$item.fields.mood.value", comparator: "IS_EMPTY" });
  });
  it("is idempotent", () => {
    expect(excludeMoodRows(excludeMoodRows(pipe(), ids).pipeline, ids).groups).toBe(0);
  });
  // THE CONTROL: a group that does not test Completed is untouched.
  it("leaves other groups alone", () => {
    const p = { steps: [{ type: "if", condition: { operator: "AND", rules: [{ left: "$x", comparator: "IS", right: 1 }] } }] };
    expect(excludeMoodRows(p, ids).groups).toBe(0);
  });
});
