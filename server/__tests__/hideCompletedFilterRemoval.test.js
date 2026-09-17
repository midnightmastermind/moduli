// __tests__/hideCompletedFilterRemoval.test.js
//
// Removing a filter is removing something that HIDES, so the risk is entirely
// which ones go. These are about `0334` taking the hide-on-Completed filters
// and NOTHING ELSE — including any other local filter the user put on the same
// container.
import { describe, it, expect } from "vitest";
import {
  resolveCompletedField,
  hidesOnCompleted,
  planFilterRemoval,
} from "../migrations/0334-a-ticked-task-stays-where-it-is.mjs";

const COMPLETED = "fid_completed";
const hideCompleted = (id = "hide-completed-x") => ({
  id, active: true, hides: true,
  condition: { operator: "AND", rules: [{ id: "r", left: `$occ.fields.${COMPLETED}.value`, comparator: "IS_NOT", right: true }] },
});

describe("resolveCompletedField", () => {
  it("resolves the boolean field named Completed", () => {
    expect(resolveCompletedField([
      { id: COMPLETED, name: "Completed", type: "boolean" },
      { id: "other", name: "Completed On", type: "date" },
    ])).toBe(COMPLETED);
  });

  // THE TYPE IS THE DISCRIMINATOR, not the name. This grid carries duplicate
  // field names, and clearing filters keyed on the wrong field would un-hide
  // something nobody asked about.
  it("refuses when the name is ambiguous within the type", () => {
    expect(() => resolveCompletedField([
      { id: "a", name: "Completed", type: "boolean" },
      { id: "b", name: "Completed", type: "boolean" },
    ])).toThrow(/exactly one/);
  });

  it("refuses when there is none", () => {
    expect(() => resolveCompletedField([{ id: "x", name: "Water", type: "number" }])).toThrow(/exactly one/);
  });

  // A same-named field of ANOTHER type must not be picked up.
  it("ignores a same-named field of a different type", () => {
    expect(resolveCompletedField([
      { id: COMPLETED, name: "Completed", type: "boolean" },
      { id: "txt", name: "Completed", type: "text" },
    ])).toBe(COMPLETED);
  });
});

describe("hidesOnCompleted", () => {
  it("matches the hide-completed shape", () => {
    expect(hidesOnCompleted(hideCompleted(), COMPLETED)).toBe(true);
  });

  // A filter that SHOWS on Completed is a different feature (the Completed
  // container could legitimately carry one) and must survive.
  it("refuses a filter that does not hide", () => {
    expect(hidesOnCompleted({ ...hideCompleted(), hides: false }, COMPLETED)).toBe(false);
  });

  // The rule must be the WHOLE condition. "Hide completed things dated before
  // today" is a narrower, deliberate filter — dropping it would change what a
  // container shows in a way nobody asked for.
  it("refuses a filter that tests Completed AND something else", () => {
    const f = hideCompleted();
    f.condition.rules.push({ id: "r2", left: "$occ.fields.date.value", comparator: "IS_NOT_EMPTY" });
    expect(hidesOnCompleted(f, COMPLETED)).toBe(false);
  });

  it("refuses a filter on a different field", () => {
    expect(hidesOnCompleted(hideCompleted(), "some_other_field")).toBe(false);
  });
});

describe("planFilterRemoval", () => {
  it("removes the hide-completed filter and KEEPS the others", () => {
    const other = { id: "mine", active: true, hides: true, condition: { operator: "AND", rules: [{ id: "q", left: "$occ.fields.tag.value", comparator: "CONTAINS", right: "x" }] } };
    const plan = planFilterRemoval([{ _id: 1, id: "c1", filters: [hideCompleted(), other] }], COMPLETED);
    expect(plan).toHaveLength(1);
    expect(plan[0].removed).toBe(1);
    expect(plan[0].next).toEqual([other]);
  });

  // The control: a container with no such filter is ABSENT from the plan, so a
  // re-run writes nothing. Without it, "removes them" is also satisfied by a
  // pass that rewrites every container's filters on every run.
  it("leaves a container with no hide-completed filter out of the plan", () => {
    expect(planFilterRemoval([
      { _id: 1, id: "completed", filters: [] },
      { _id: 2, id: "viafluere" },
    ], COMPLETED)).toEqual([]);
  });

  it("is idempotent — a second pass over the result plans nothing", () => {
    const occs = [{ _id: 1, id: "c1", filters: [hideCompleted()] }];
    const plan = planFilterRemoval(occs, COMPLETED);
    const after = [{ _id: 1, id: "c1", filters: plan[0].next }];
    expect(planFilterRemoval(after, COMPLETED)).toEqual([]);
  });
});
