// __tests__/categoryScopePolicy.test.js
//
// Drives the transform against REAL makeTrackerOp output (plus the real
// periodAllPolicy, since that is the shape it meets on a live grid) — the same
// discipline periodAllPolicy.test.js uses. Asserting against a hand-written
// pipeline would prove the transform matches my idea of a tracker rather than
// the trackers that actually ship.
import { describe, it, expect } from "vitest";
import { makeTrackerOp } from "../utils/liveSystemBuilders.js";
import { applyPeriodAllPolicy } from "../utils/periodAllPolicy.js";
import { applyCategoryScope } from "../utils/categoryScopePolicy.js";

const DATE = "date-field-01";
const CAT = "tags-field-01";

const tracker = () => makeTrackerOp({
  userId: "u1", gridId: "g1", name: "Water",
  goalOccurrenceId: "goal-1", goalFieldId: "goal-fld", dateFieldId: DATE,
  completedFieldId: "done-fld", sourceFieldId: "water-fld",
  agg: "sum", scopePageOccId: "sched-page",
});

const walk = (node, fn) => {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach(n => walk(n, fn));
  fn(node);
  Object.values(node).forEach(v => walk(v, fn));
};
const collectRules = (op) => { const out = []; walk(op.pipeline, n => { if (n.comparator) out.push(n); }); return out; };
const initVars = (op) => { const out = []; walk(op.pipeline, n => { if (n.type === "INIT_VAR") out.push(n); }); return out; };

describe("the category axis is the date axis, one field over", () => {
  it("binds $goalCategory from the SAME source the op reads its date filter from", () => {
    const op = tracker();
    applyCategoryScope([op], { categoryFieldId: CAT });
    const period = initVars(op).find(v => v.name === "$goalPeriod" && /_effectiveFilter/.test(v.expr));
    const category = initVars(op).find(v => v.name === "$goalCategory");
    expect(period.expr).toBe(`$goalItem._effectiveFilter.${DATE}`);
    expect(category.expr).toBe(`$goalItem._effectiveFilter.${CAT}`);   // same prefix, category field
  });

  it("gates the LOOP by category", () => {
    const op = tracker();
    applyCategoryScope([op], { categoryFieldId: CAT });
    const hit = collectRules(op).filter(r => r.left === `$item.fields.${CAT}.value` && r.comparator === "CONTAINS");
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.every(r => r.right === "$goalCategory")).toBe(true);
  });

  // The distinction that keeps the numbers honest: gating the trigger would stop
  // a tracker recomputing after an out-of-category edit, leaving a stale total.
  // The assertion has to be about the GROUP, not the rule: the gate's own left is
  // always `$item.…` wherever it lands, so a rule-level check can never catch a
  // gate placed in a trigger group. And landing there is not cosmetic — `$item`
  // is unbound in a trigger context and referencing an unbound var THROWS, so
  // the op would stop firing entirely. (A/B'd: the first version of this test
  // passed against a transform that gated triggers too.)
  it("never gates a group that tests the TRIGGER", () => {
    const op = tracker();
    applyCategoryScope([op], { categoryFieldId: CAT });
    const offenders = [];
    walk(op.pipeline, (n) => {
      if (!Array.isArray(n.rules)) return;
      const testsTrigger = n.rules.some(r => typeof r?.left === "string" && r.left.startsWith("$trigger."));
      const hasCategory = n.rules.some(r =>
        (r?.right === "$goalCategory")
        || (Array.isArray(r?.rules) && r.rules.some(x => x?.right === "$goalCategory")));
      if (testsTrigger && hasCategory) offenders.push(n);
    });
    expect(offenders).toEqual([]);
  });

  // The control that makes the assertion above mean something: the fixture DOES
  // contain trigger groups carrying a date gate, so "no offenders" is a
  // measurement rather than an empty search.
  it("the fixture really does have trigger groups with a date gate", () => {
    const op = tracker();
    const withTriggerDate = [];
    walk(op.pipeline, (n) => {
      if (Array.isArray(n.rules) && n.rules.some(r =>
        typeof r?.left === "string" && r.left.startsWith("$trigger.")
        && r.comparator === "DATE_IN_PERIOD" && r.right === "$goalPeriod")) withTriggerDate.push(n);
    });
    expect(withTriggerDate.length).toBeGreaterThan(0);
  });

  // Without this arm every tile reads 0 on a page with no category picked —
  // periodAllPolicy's rule, for the same reason.
  it("an empty category still matches everything", () => {
    const op = tracker();
    applyCategoryScope([op], { categoryFieldId: CAT });
    const gates = [];
    walk(op.pipeline, n => {
      if (Array.isArray(n.rules) && n.rules.some(r => r.comparator === "CONTAINS" && r.right === "$goalCategory")) gates.push(n);
    });
    expect(gates.length).toBeGreaterThan(0);
    for (const gate of gates) {
      expect(gate.operator).toBe("OR");           // matching OR unset — never a bare AND
      expect(gate.rules.some(r => r.left === "$goalCategory" && r.comparator === "IS_EMPTY")).toBe(true);
    }
  });

  it("composes with periodAllPolicy — the shape it meets on a live grid", () => {
    const op = tracker();
    applyPeriodAllPolicy([op]);                       // date rule becomes an OR wrapper first
    const changed = applyCategoryScope([op], { categoryFieldId: CAT });
    expect(changed).toHaveLength(1);
    expect(changed[0].gates).toBeGreaterThan(0);
  });

  it("is idempotent — a second pass changes nothing", () => {
    const op = tracker();
    applyCategoryScope([op], { categoryFieldId: CAT });
    const after = JSON.stringify(op.pipeline);
    const second = applyCategoryScope([op], { categoryFieldId: CAT });
    expect(second).toHaveLength(0);
    expect(JSON.stringify(op.pipeline)).toBe(after);
  });

  it("leaves an op that resolves no $goalPeriod alone", () => {
    const op = { name: "Build Schedule", pipeline: { steps: [
      { id: "s1", type: "action", config: { type: "INIT_VAR", name: "$day", expr: "$today" } },
    ] } };
    const before = JSON.stringify(op.pipeline);
    expect(applyCategoryScope([op], { categoryFieldId: CAT })).toHaveLength(0);
    expect(JSON.stringify(op.pipeline)).toBe(before);
  });

  it("refuses without a category field rather than writing a broken rule", () => {
    expect(() => applyCategoryScope([tracker()], {})).toThrow(/categoryFieldId/);
  });

  // Both of these were found by checking the dry run against a named expectation,
  // NOT by this suite — it passed against both bugs. They are pinned now.

  it("never puts the gate INSIDE the period-all wrapper (which would void the date filter)", () => {
    const op = tracker();
    applyPeriodAllPolicy([op]);
    applyCategoryScope([op], { categoryFieldId: CAT });
    const offenders = [];
    walk(op.pipeline, (n) => {
      if (!Array.isArray(n.rules) || n.operator !== "OR") return;
      const isWrapper = n.rules.some(r => r?.left === "$goalPeriod" && r?.comparator === "IS_EMPTY");
      const hasCat = n.rules.some(r => Array.isArray(r?.rules) && r.rules.some(x => x?.right === "$goalCategory"));
      if (isWrapper && hasCat) offenders.push(n);
    });
    expect(offenders).toEqual([]);
  });

  it("never emits a gate into an op it could not bind $goalCategory in", () => {
    // A tracker whose $goalPeriod comes from $today alone — no _effectiveFilter
    // to mirror. Six live trackers look like this. A gate here would reference an
    // unbound var, which THROWS, so the op would stop firing entirely.
    const op = {
      name: "Inline tracker", pipeline: { steps: [
        { id: "a", type: "action", config: { type: "INIT_VAR", name: "$goalPeriod", expr: "$today" } },
        { id: "b", type: "loop", overExpr: "$allInstances", as: "$moodInst", body: [
          { id: "c", type: "if", condition: { operator: "AND", rules: [
            { id: "d", left: "$moodInst.fields.date-field-01.value", comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
          ] }, then: [] },
        ] },
      ] },
    };
    const changed = applyCategoryScope([op], { categoryFieldId: CAT });
    expect(changed).toHaveLength(0);
    expect(changed.skipped).toEqual(["Inline tracker"]);
    expect(JSON.stringify(op.pipeline)).not.toContain("$goalCategory");
  });

  // The generalization: makeTrackerOp loops `$item`, the hand-written media
  // trackers loop `$watchInst` / `$moodInst`. The gate must read whichever the
  // date gate beside it reads, or it names a var that does not exist.
  it("reads the same loop variable the date gate reads, whatever it is called", () => {
    const op = {
      name: "Movies", pipeline: { steps: [
        { id: "a", type: "action", config: { type: "INIT_VAR", name: "$goalPeriod", expr: `$goalItem._effectiveFilter.${DATE}` } },
        { id: "b", type: "loop", overExpr: "$allInstances", as: "$watchInst", body: [
          { id: "c", type: "if", condition: { operator: "AND", rules: [
            { id: "d", left: `$watchInst.fields.${DATE}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
          ] }, then: [] },
        ] },
      ] },
    };
    applyCategoryScope([op], { categoryFieldId: CAT });
    const gate = collectRules(op).find(r => r.right === "$goalCategory" && r.comparator === "CONTAINS");
    expect(gate.left).toBe(`$watchInst.fields.${CAT}.value`);
  });
});

describe("the fail-closed check sees a NESTED binding", () => {
  // Eight live trackers resolve $goalPeriod inside an if-branch. addCategoryVar
  // recurses, so the binding lands nested — a top-level scan misses it and calls
  // a patched op uncovered.
  const nestedOp = () => ({
    name: "Nested Tracker",
    pipeline: { steps: [
      { id: "a", type: "if", then: [
        { id: "b", type: "action", config: { type: "INIT_VAR", name: "$goalPeriod", expr: "$goalItem._effectiveFilter.DATE" } },
        { id: "c", type: "loop", predicate: { operator: "AND", rules: [
          { id: "d", left: "$item.fields.DATE.value", comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
        ] } },
      ] },
    ] },
  });

  it("patches it on the first pass", () => {
    const op = nestedOp();
    const changed = applyCategoryScope([op], { categoryFieldId: "CAT" });
    expect(changed).toHaveLength(1);
    expect(changed[0].vars).toBe(1);
    expect(changed[0].gates).toBe(1);
    expect(changed.skipped).toEqual([]);
  });

  it("does NOT report it as uncovered on the second pass", () => {
    const op = nestedOp();
    applyCategoryScope([op], { categoryFieldId: "CAT" });
    const again = applyCategoryScope([op], { categoryFieldId: "CAT" });
    expect(again.skipped).toEqual([]);          // the bug reported it here
    expect(again).toHaveLength(0);              // and it stays idempotent
    expect(JSON.stringify(op).match(/\$goalCategory/g).length).toBe(3); // 1 var + 2 gate refs
  });
});
