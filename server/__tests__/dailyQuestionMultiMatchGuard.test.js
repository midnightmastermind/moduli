// The "$dq has no id to update" guard (migration 0066 + its builder twin).
//
// The bug: a FIND that matches MORE THAN ONE binds an ARRAY. `$dqId
// IS_NOT_EMPTY` passes for an array of ids, so the UPDATE runs and throws
// because an array has no `.id`.
import { describe, it, expect } from "vitest";
import { addMultiMatchGuard } from "../migrations/0066-daily-question-multi-match-guard.mjs";
import { makeDayPageBuildOp } from "../utils/liveSystemBuilders.js";

const guardRules = (op) => {
  // Find every condition group that gates on $dqId, at any depth.
  const found = [];
  const walk = (steps) => {
    if (!Array.isArray(steps)) return;
    for (const st of steps) {
      const visit = (g) => {
        if (!Array.isArray(g?.rules)) return;
        for (const r of g.rules) if (Array.isArray(r?.rules)) visit(r);
        if (g.rules.some((r) => r?.left === "$dqId")) found.push(g.rules);
      };
      visit(st?.condition);
      walk(st?.then); walk(st?.else); walk(st?.body);
    }
  };
  walk(op?.pipeline?.steps);
  return found;
};

const opWithGuard = () => ({
  name: "Day Page: Build",
  pipeline: { steps: [
    { type: "action", config: { type: "FIND", itemIdVar: "$dqId", itemVar: "$dq" } },
    { type: "if",
      condition: { operator: "AND", rules: [
        { id: "a", left: "$dqId", comparator: "IS_NOT_EMPTY", right: "" },
        { id: "b", left: "$dq.fields.q.value", comparator: "IS_EMPTY", right: "" },
      ]},
      then: [{ type: "action", config: { type: "UPDATE", path: "$dq.fields.q.value" } }],
      else: [],
    },
  ]},
});

describe("0066 — Daily Question multi-match guard", () => {
  it("adds `$dq.id IS_NOT_EMPTY` directly after the $dqId anchor", () => {
    const op = opWithGuard();
    const report = addMultiMatchGuard(op);
    expect(report.changed).toBe(true);
    expect(report.added).toBe(1);
    const rules = guardRules(op)[0];
    const at = rules.findIndex((r) => r.left === "$dqId");
    // Order is the readable one: $dqId guards matched-NOTHING, $dq.id guards
    // matched-MANY.
    expect(rules[at + 1].left).toBe("$dq.id");
    expect(rules[at + 1].comparator).toBe("IS_NOT_EMPTY");
  });

  it("KEEPS the $dqId rule — it is what guards the matched-nothing case", () => {
    const op = opWithGuard();
    addMultiMatchGuard(op);
    const rules = guardRules(op)[0];
    expect(rules.some((r) => r.left === "$dqId" && r.comparator === "IS_NOT_EMPTY")).toBe(true);
  });

  it("is idempotent — a second run adds nothing and reports it", () => {
    const op = opWithGuard();
    addMultiMatchGuard(op);
    const second = addMultiMatchGuard(op);
    expect(second.changed).toBe(false);
    expect(second.alreadyGuarded).toBe(1);
    expect(guardRules(op)[0].filter((r) => r.left === "$dq.id")).toHaveLength(1);
  });

  it("REFUSES with a reason when there is no anchor to attach to", () => {
    const op = { name: "Day Page: Build", pipeline: { steps: [
      { type: "if", condition: { operator: "AND", rules: [{ left: "$other", comparator: "IS", right: "x" }] }, then: [], else: [] },
    ]}};
    const report = addMultiMatchGuard(op);
    expect(report.changed).toBe(false);
    expect(report.reason).toMatch(/no .*guard found/i);
  });

  it("finds a guard NESTED inside an OR group, not just at the top level", () => {
    const op = { name: "Day Page: Build", pipeline: { steps: [
      { type: "if",
        condition: { operator: "AND", rules: [
          { left: "$colId", comparator: "IS_NOT_EMPTY", right: "" },
          { operator: "OR", rules: [
            { left: "$dqId", comparator: "IS_NOT_EMPTY", right: "" },
          ]},
        ]},
        then: [], else: [] },
    ]}};
    const report = addMultiMatchGuard(op);
    expect(report.added).toBe(1);
  });

  // THE ONE THAT MATTERS. The guard has to change the OUTCOME for an array —
  // asserting the rule exists proves nothing about whether it fires.
  it("an ARRAY-bound $dq fails the guard while a RECORD passes it", () => {
    const op = opWithGuard();
    addMultiMatchGuard(op);
    const rules = guardRules(op)[0];
    // Evaluate the guard the way the executor would: every rule must hold.
    const holds = ($dqId, $dq) => rules.every((r) => {
      const left = r.left === "$dqId" ? $dqId
        : r.left === "$dq.id" ? $dq?.id
        : r.left === "$dq.fields.q.value" ? $dq?.fields?.q?.value
        : undefined;
      const empty = left === undefined || left === null || left === ""
        || (Array.isArray(left) && left.length === 0);
      return r.comparator === "IS_NOT_EMPTY" ? !empty : empty;
    });

    const record = { id: "dq-1", fields: { q: { value: "" } } };
    const array = [record, { id: "dq-2", fields: { q: { value: "" } } }];

    expect(holds("dq-1", record)).toBe(true);                 // one match -> fill
    expect(holds(["dq-1", "dq-2"], array)).toBe(false);       // many -> SKIP, not throw
    expect(holds(undefined, undefined)).toBe(false);          // none -> skip
  });

  // The builder and the migration must not drift: a reseeded grid and a migrated
  // grid have to end up with the same guard.
  it("the BUILDER already emits the same guard the migration adds", () => {
    const op = makeDayPageBuildOp({
      userId: "u", gridId: "g", dateFieldId: "d",
      dayPageBoardOccId: "board", schedulePageOccId: "sched",
      dayPageTemplateOccId: "tpl",
      journalQuestionFieldId: "q", questionPoolModuleId: "pool",
    });
    const groups = guardRules(op);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0].some((r) => r.left === "$dq.id" && r.comparator === "IS_NOT_EMPTY")).toBe(true);
    // And the migration is therefore a no-op against a freshly built op.
    expect(addMultiMatchGuard(op).changed).toBe(false);
  });
});
