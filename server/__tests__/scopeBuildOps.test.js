// The 0062 migration edits a STORED pipeline in place, which is the shape of
// edit that has damaged this grid before (0035 moved a real page). So the tests
// are about what it must NOT touch as much as what it changes.
import { describe, it, expect } from "vitest";
import { tightenOp, addGuard } from "../migrations/0062-scope-build-ops-to-their-own-page.mjs";

const guard = (...rights) => ({
  id: "g", type: "if",
  condition: { operator: "OR", rules: [
    { id: "r0", left: "$trigger.sourceOccurrenceId", comparator: "IS_EMPTY", right: "" },
    ...rights.map((r, i) => ({ id: `r${i + 1}`, left: "$trigger.sourceOccurrenceId", comparator: "IS", right: r })),
  ]},
  then: [{ id: "inner", type: "action", config: { type: "CREATE", label: "x" } }],
});

const opWith = (steps) => ({ name: "Day Page: Build", pipeline: { steps } });
const KEEP = new Set(["$board.id"]);

describe("0062 tightenOp", () => {
  it("drops the foreign pages and keeps the op's own page + the toolbar case", () => {
    const op = opWith([
      { id: "v1", type: "action", config: { type: "INIT_VAR", name: "$goalsPage", expr: "$allItemsById.goals-1" } },
      guard("$schedPage.id", "$goalsPage.id", "$board.id"),
    ]);
    const r = tightenOp(op, KEEP);
    expect(r.changed).toBe(true);
    expect(r.droppedRules.sort()).toEqual(["$goalsPage.id", "$schedPage.id"]);
    const rules = op.pipeline.steps[0].condition.rules;   // the INIT_VAR was removed
    expect(rules.map((x) => `${x.comparator}:${x.right}`)).toEqual(["IS_EMPTY:", "IS:$board.id"]);
  });

  it("removes the $goalsPage INIT_VAR left dead by the drop", () => {
    const op = opWith([
      { id: "v1", type: "action", config: { type: "INIT_VAR", name: "$goalsPage", expr: "$allItemsById.goals-1" } },
      guard("$goalsPage.id", "$board.id"),
    ]);
    tightenOp(op, KEEP);
    expect(JSON.stringify(op.pipeline)).not.toContain("$goalsPage");
  });

  it("KEEPS a var that is still read elsewhere — $schedPage drives the todo pass", () => {
    // The discriminating case: dropping a guard rule does not make its var dead
    // if the pipeline reads it somewhere else. Removing it would break the pass.
    const op = opWith([
      { id: "v1", type: "action", config: { type: "INIT_VAR", name: "$schedPage", expr: "$allItemsById.sched-1" } },
      { id: "v2", type: "action", config: { type: "INIT_VAR", name: "$goalsPage", expr: "$allItemsById.goals-1" } },
      guard("$schedPage.id", "$goalsPage.id", "$board.id"),
      { id: "use", type: "action", config: { type: "INIT_VAR", name: "$x", expr: "$schedPage.id" } },
    ]);
    tightenOp(op, KEEP);
    const json = JSON.stringify(op.pipeline);
    expect(json).toContain("$schedPage");      // still initialised
    expect(json).not.toContain("$goalsPage");  // genuinely dead, gone
  });

  it("is IDEMPOTENT — a second pass reports no change and writes nothing", () => {
    const op = opWith([guard("$schedPage.id", "$board.id")]);
    tightenOp(op, KEEP);
    const after = JSON.stringify(op.pipeline);
    const second = tightenOp(op, KEEP);
    expect(second.changed).toBe(false);
    expect(JSON.stringify(op.pipeline)).toBe(after);
  });

  it("touches NOTHING but the source guard", () => {
    const other = { id: "o", type: "if",
      condition: { operator: "AND", rules: [{ id: "z", left: "$dayColId", comparator: "IS_EMPTY", right: "" }] },
      then: [{ id: "c", type: "action", config: { type: "CREATE", label: "day" } }] };
    const op = opWith([guard("$goalsPage.id", "$board.id"), other]);
    const snapshot = JSON.stringify(other);
    tightenOp(op, KEEP);
    expect(JSON.stringify(op.pipeline.steps[1])).toBe(snapshot);
  });

  it("finds a guard nested inside another branch, not just at the top", () => {
    const op = opWith([{ id: "outer", type: "if",
      condition: { operator: "AND", rules: [{ id: "q", left: "$x", comparator: "IS_NOT_EMPTY", right: "" }] },
      then: [guard("$goalsPage.id", "$board.id")] }]);
    const r = tightenOp(op, KEEP);
    expect(r.droppedRules).toEqual(["$goalsPage.id"]);
  });

  it("reports no change on an op with no source guard at all", () => {
    const op = opWith([{ id: "a", type: "action", config: { type: "CREATE", label: "x" } }]);
    expect(tightenOp(op, KEEP).changed).toBe(false);
  });
});

describe("0062 addGuard — for the op that had NO guard", () => {
  const mk = () => ({ name: "Schedule: Place Dated Work", pipeline: { steps: [
    { id: "v1", type: "action", config: { type: "INIT_VAR", name: "$schedPage", expr: "$allItemsById.s1" } },
    { id: "v2", type: "action", config: { type: "INIT_VAR", name: "$schedPageId", expr: "$schedPage.id" } },
    { id: "pre", type: "if",
      condition: { operator: "AND", rules: [{ id: "a", left: "$schedPageId", comparator: "IS_NOT_EMPTY", right: "" }] },
      then: [{ id: "work", type: "loop", overExpr: "$activePeriodDates", as: "$day", body: [] }] },
  ] } });
  const SPEC = { own: "$schedPage.id", anchorLeft: "$schedPageId" };
  const ids = (() => { let n = 0; return () => `id-${n++}`; })();

  it("nests the guard into the existing precondition, keeping the toolbar case", () => {
    const op = mk();
    expect(addGuard(op, SPEC, ids).added).toBe(true);
    const rules = op.pipeline.steps[2].condition.rules;
    expect(rules[0].left).toBe("$schedPageId");            // precondition untouched
    const group = rules[1];
    expect(group.operator).toBe("OR");
    expect(group.rules.map((r) => `${r.comparator}:${r.right}`))
      .toEqual(["IS_EMPTY:", "IS:$schedPage.id"]);
  });

  it("does not touch the work the precondition guards", () => {
    const op = mk();
    const work = JSON.stringify(op.pipeline.steps[2].then);
    addGuard(op, SPEC, ids);
    expect(JSON.stringify(op.pipeline.steps[2].then)).toBe(work);
  });

  it("is IDEMPOTENT — a second run adds nothing", () => {
    const op = mk();
    addGuard(op, SPEC, ids);
    const after = JSON.stringify(op.pipeline);
    const second = addGuard(op, SPEC, ids);
    expect(second.added).toBe(false);
    expect(second.reason).toBe("already guarded");
    expect(JSON.stringify(op.pipeline)).toBe(after);
  });

  it("FAILS CLOSED with a reason when there is no precondition to attach to", () => {
    // Guessing where a guard belongs in someone else's pipeline is how a
    // migration writes the wrong thing.
    const op = { name: "x", pipeline: { steps: [{ id: "a", type: "action", config: { type: "CREATE" } }] } };
    const r = addGuard(op, SPEC, ids);
    expect(r.added).toBe(false);
    expect(r.reason).toMatch(/no precondition/);
    expect(JSON.stringify(op.pipeline)).not.toContain("sourceOccurrenceId");
  });

  it("the guard it writes is the shape tightenOp can still read (nested group)", () => {
    // The two halves have to agree, or a later tightening pass silently misses
    // what this one wrote.
    const op = mk();
    addGuard(op, SPEC, ids);
    op.pipeline.steps[2].condition.rules[1].rules.push(
      { id: "foreign", left: "$trigger.sourceOccurrenceId", comparator: "IS", right: "$goalsPage.id" });
    const r = tightenOp(op, new Set(["$schedPage.id"]));
    expect(r.droppedRules).toEqual(["$goalsPage.id"]);
  });
});
