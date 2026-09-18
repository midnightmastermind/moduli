// 0341's two pipeline edits. The BEHAVIOURAL half — that the patched builder
// really stops sweeping a check-in and really re-lists it — runs the real
// executor in `client/src/__tests__/tasksCompletedBuilder.test.js`.
import { describe, it, expect } from "vitest";
import { keepMoodCheckIns, relistMoodCheckIns }
  from "../migrations/0341-tasks-completed-keeps-the-days-check-ins.mjs";

const MOOD = "fld-mood", DATE = "fld-date", HABIT = "fld-habit", DONE = "fld-completed";

// The live shape, which puts the action name in `config.type` (this op's
// dialect) rather than in `actionType`.
export const builder = () => ({
  sources: [],
  steps: [
    { id: "find-col", type: "action", config: { type: "FIND", itemIdVar: "$dayPageId" } },
    { id: "guard", type: "if", condition: { operator: "AND", rules: [] }, then: [
      { id: "find-tc", type: "action", config: { type: "FIND", itemIdVar: "$tcContId" } },
      { id: "tc-guard", type: "if", condition: { operator: "AND", rules: [] }, then: [
        { id: "sweep", type: "loop", overExpr: "$tcCont.occurrences", as: "$kidId", body: [
          { id: "kid", type: "action", config: { type: "INIT_VAR", name: "$kid", expr: "$allItemsById.${$kidId}" } },
          { id: "keep", type: "if",
            condition: { operator: "AND", rules: [
              { left: `$kid.fields.${DONE}.value`, comparator: "IS", right: "true" },
              { left: `$kid.fields.${DATE}.value`, comparator: "SAME_DAY", right: "$dayDate" },
              { left: "$kid._boundFieldIds", comparator: "ARRAY_NOT_INCLUDES", right: HABIT },
            ] },
            then: [],
            else: [{ id: "rm", type: "action",
              config: { type: "REMOVE_CHILD", parentId: "$tcContId", childId: "$kidId" } }] },
        ] },
        { id: "add", type: "loop", over: "$allInstances", as: "$task",
          predicate: { operator: "AND", rules: [] },
          body: [{ id: "ac", type: "action",
            config: { type: "ADD_CHILD", parentId: "$tcContId", childId: "$task.id" } }] },
      ], else: [] },
    ], else: [] },
  ],
});

const args = { moodFieldId: MOOD, dateFieldId: DATE };
const sweepBody = (p) => p.steps[1].then[1].then[0].body;
const tcBranch = (p) => p.steps[1].then[1].then;

describe("0341 keepMoodCheckIns", () => {
  it("wraps the removal in a mood-row test rather than editing the keep rule", () => {
    // The keep rule is the Completed-tasks contract; widening it would change
    // what the builder ADDS as well as what it spares.
    const { pipeline, wrapped } = keepMoodCheckIns(builder(), args);
    expect(wrapped).toBe(1);
    const keep = sweepBody(pipeline)[1];
    expect(keep.condition.rules).toHaveLength(3);
    const spare = keep.else[0];
    expect(spare.type).toBe("if");
    expect(spare.condition.rules.map((r) => r.comparator)).toEqual(["IS_NOT_EMPTY", "SAME_DAY"]);
    expect(spare.then).toEqual([]);
    expect(spare.else[0].config.type).toBe("REMOVE_CHILD");
  });

  it("spares only rows dated the day being built", () => {
    const { pipeline } = keepMoodCheckIns(builder(), args);
    const rules = sweepBody(pipeline)[1].else[0].condition.rules;
    expect(rules[0].left).toBe(`$kid.fields.${MOOD}.value`);
    expect(rules[1].right).toBe("$dayDate");
  });

  it("is idempotent — a second run wraps nothing", () => {
    const once = keepMoodCheckIns(builder(), args).pipeline;
    expect(keepMoodCheckIns(once, args).wrapped).toBe(0);
  });

  it("THROWS when there is no sweep to guard", () => {
    const p = builder();
    p.steps[1].then[1].then[0].body[1].else = [];
    expect(() => keepMoodCheckIns(p, args)).toThrow(/found 0/);
  });

  it("leaves a REMOVE_CHILD from some OTHER parent alone", () => {
    const p = builder();
    tcBranch(p).push({ id: "other", type: "action",
      config: { type: "REMOVE_CHILD", parentId: "$somewhereElse", childId: "$x" } });
    const { pipeline } = keepMoodCheckIns(p, args);
    expect(tcBranch(pipeline)[2].config.type).toBe("REMOVE_CHILD");
  });
});

describe("0341 relistMoodCheckIns", () => {
  it("appends a second add loop right after the tasks one", () => {
    const { pipeline, added } = relistMoodCheckIns(builder(), args);
    expect(added).toBe(1);
    const loops = tcBranch(pipeline).filter((s) => s.type === "loop" && s.over === "$allInstances");
    expect(loops).toHaveLength(2);
    expect(tcBranch(pipeline)[2].as).toBe("$moodRow");
    expect(tcBranch(pipeline)[2].body[0].config).toEqual(
      { type: "ADD_CHILD", parentId: "$tcContId", childId: "$moodRow.id" });
  });

  it("scopes to the DAY PAGE, so a journal's Mood row is not pulled in", () => {
    // The discriminating case: journals live under the Schedule page and carry
    // both a Mood and a Date, so a predicate without this takes them too.
    const rules = relistMoodCheckIns(builder(), args).pipeline.steps[1].then[1].then[2].predicate.rules;
    expect(rules[0]).toMatchObject({ left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$dayPageId" });
  });

  it("asks for the row's OWN fields, not $kid's — a different loop variable", () => {
    const rules = relistMoodCheckIns(builder(), args).pipeline.steps[1].then[1].then[2].predicate.rules;
    expect(rules[1].left).toBe(`fields.${MOOD}.value`);
    expect(rules[2].left).toBe(`fields.${DATE}.value`);
  });

  it("is idempotent — a second run adds nothing", () => {
    const once = relistMoodCheckIns(builder(), args).pipeline;
    expect(relistMoodCheckIns(once, args).added).toBe(0);
  });

  it("THROWS when the add loop it anchors on is gone", () => {
    const p = builder();
    p.steps[1].then[1].then = [p.steps[1].then[1].then[0]];
    expect(() => relistMoodCheckIns(p, args)).toThrow(/found 0/);
  });

  it("composes with the sweep guard in either order", () => {
    const a = relistMoodCheckIns(keepMoodCheckIns(builder(), args).pipeline, args).pipeline;
    const b = keepMoodCheckIns(relistMoodCheckIns(builder(), args).pipeline, args).pipeline;
    expect(a).toEqual(b);
  });
});
