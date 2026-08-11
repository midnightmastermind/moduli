import { describe, it, expect } from "vitest";
import { planMerge, repointPipeline, DUE_MARKER, TODO_MARKER }
  from "../migrations/0070-merge-due-into-todo.mjs";

const TS = "f-ts";
const mk = (id, marker, kids = []) => ({
  id, occurrences: kids, fields: marker ? { [TS]: { value: marker } } : {},
});
const day = (id, kids) => ({ id, occurrences: kids, fields: {} });

describe("0070 planMerge", () => {
  it("pairs a Due with the Todo under the SAME parent", () => {
    const occs = [day("col", ["due", "todo"]), mk("due", DUE_MARKER, ["t1"]), mk("todo", TODO_MARKER)];
    const { pairs } = planMerge({ occurrences: occs, timeslotFieldId: TS });
    expect(pairs).toHaveLength(1);
    expect(pairs[0].moving).toEqual(["t1"]);
    expect(pairs[0].nextTodo).toEqual(["t1"]);
  });

  it("NEVER pairs across days — a Due with no sibling Todo is left alone", () => {
    // The discriminating refusal: guessing a destination would silently
    // reschedule the user's work into another day.
    const occs = [day("colA", ["due"]), mk("due", DUE_MARKER, ["t1"]),
                  day("colB", ["todo"]), mk("todo", TODO_MARKER)];
    const { pairs, orphans } = planMerge({ occurrences: occs, timeslotFieldId: TS });
    expect(pairs).toEqual([]);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].kids).toEqual(["t1"]);
  });

  it("DE-DUPLICATES a child the Due lists more than once", () => {
    // Real data: Due listed one occurrence three times.
    const occs = [day("col", ["due", "todo"]), mk("due", DUE_MARKER, ["t1", "t1", "t1"]), mk("todo", TODO_MARKER)];
    expect(planMerge({ occurrences: occs, timeslotFieldId: TS }).pairs[0].nextTodo).toEqual(["t1"]);
  });

  it("does not re-add a child the Todo already has", () => {
    const occs = [day("col", ["due", "todo"]), mk("due", DUE_MARKER, ["t1"]), mk("todo", TODO_MARKER, ["t1"])];
    const [p] = planMerge({ occurrences: occs, timeslotFieldId: TS }).pairs;
    expect(p.moving).toEqual([]);
    expect(p.nextTodo).toEqual(["t1"]);
  });

  it("matches on the MARKER, not the label", () => {
    // A container merely labelled "Due" with a Todo marker is a Todo.
    const occs = [day("col", ["x", "todo"]), { ...mk("x", TODO_MARKER), label: "Due" }, mk("todo", TODO_MARKER)];
    expect(planMerge({ occurrences: occs, timeslotFieldId: TS }).pairs).toEqual([]);
  });

  it("ignores a grid with no Due at all — the re-run guard", () => {
    const occs = [day("col", ["todo"]), mk("todo", TODO_MARKER, ["t1"])];
    const { pairs, orphans } = planMerge({ occurrences: occs, timeslotFieldId: TS });
    expect(pairs).toEqual([]); expect(orphans).toEqual([]);
  });
});

describe("0070 repointPipeline", () => {
  it("repoints a predicate matching the Due marker", () => {
    const pipe = { steps: [{ config: { predicate: { rules: [
      { left: `fields.${TS}.value`, comparator: "IS", right: DUE_MARKER } ] } } }] };
    const { next, hits } = repointPipeline(pipe, TS);
    expect(hits).toBe(1);
    expect(next.steps[0].config.predicate.rules[0].right).toBe(TODO_MARKER);
  });

  it("repoints a CREATE that mints a Due", () => {
    const pipe = { steps: [{ config: { type: "CREATE", name: DUE_MARKER, [TS]: `literal:${DUE_MARKER}` } }] };
    const { next, hits } = repointPipeline(pipe, TS);
    expect(hits).toBe(2);
    expect(next.steps[0].config.name).toBe(TODO_MARKER);
  });

  it("repoints the legacy LABEL match too", () => {
    const pipe = { steps: [{ config: { predicate: { rules: [{ left: "label", right: DUE_MARKER }] } } }] };
    expect(repointPipeline(pipe, TS).hits).toBe(1);
  });

  it("returns null when nothing matched, so an unrelated op is never rewritten", () => {
    const pipe = { steps: [{ config: { predicate: { rules: [{ left: "label", right: "Notes" }] } } }] };
    expect(repointPipeline(pipe, TS).next).toBeNull();
  });

  it("leaves the rest of the pipeline byte-identical", () => {
    const pipe = { sources: [{ a: 1 }], steps: [{ keep: "me", config: {
      predicate: { rules: [{ left: `fields.${TS}.value`, right: DUE_MARKER }] } } }] };
    const { next } = repointPipeline(pipe, TS);
    expect(next.sources).toEqual([{ a: 1 }]);
    expect(next.steps[0].keep).toBe("me");
  });
});
