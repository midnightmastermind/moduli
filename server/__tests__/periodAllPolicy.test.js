// server/__tests__/periodAllPolicy.test.js
// Verifies the period-all transform (utils/periodAllPolicy.js) against REAL
// makeTrackerOp output: a date-gated tracker filters by the selected period when
// the goals page has a day selected, and aggregates ALL when it doesn't. The
// transform (1) drops the $trigger.date / $today fallback IF-steps on $goalPeriod
// and (2) wraps every `DATE_IN_PERIOD $goalPeriod` rule in `(that) OR
// ($goalPeriod IS_EMPTY)`.
import { describe, it, expect } from "vitest";
import { makeTrackerOp } from "../utils/liveSystemBuilders.js";
import { applyPeriodAllPolicy } from "../utils/periodAllPolicy.js";

// Recursively collect every rule leaf (flattening nested rule groups) across a
// pipeline's steps + then/else/body branches, plus the predicate/condition rules.
function collectRules(steps) {
  const rules = [];
  const walkRules = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const r of arr) {
      rules.push(r);
      if (Array.isArray(r.rules)) walkRules(r.rules);
    }
  };
  const walk = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const s of arr) {
      if (s.condition?.rules) walkRules(s.condition.rules);
      if (s.config?.predicate?.rules) walkRules(s.config.predicate.rules);
      walk(s.then); walk(s.else); walk(s.body || s.steps);
    }
  };
  walk(steps);
  return rules;
}

function collectSteps(steps) {
  const out = [];
  const walk = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const s of arr) {
      out.push(s);
      walk(s.then); walk(s.else); walk(s.body || s.steps);
    }
  };
  walk(steps);
  return out;
}

// A "$goalPeriod fallback" IF: IF ($goalPeriod IS_EMPTY) THEN $goalPeriod = $trigger.date|$today
function isFallbackIf(s) {
  return s.type === "if"
    && s.condition?.rules?.some(r => r.left === "$goalPeriod" && r.comparator === "IS_EMPTY")
    && (s.then || []).some(a => a.config?.name === "$goalPeriod"
        && (a.config.expr === "$trigger.date" || a.config.expr === "$today"));
}

const trackerArgs = {
  userId: "u", gridId: "g", name: "Daily Water",
  goalLabel: "Physical", goalFieldId: "GF", dateFieldId: "DF", completedFieldId: "CF",
  sourceFieldId: "SF", agg: "sum", timeFilter: "daily",
};

describe("periodAllPolicy — period-all transform on a date-gated tracker", () => {
  it("the untransformed tracker HAS the $trigger.date/$today fallbacks and a bare DATE_IN_PERIOD gate", () => {
    const op = makeTrackerOp(trackerArgs);
    const steps = collectSteps(op.pipeline.steps);
    // Sanity: the fixture reproduces the shape the transform targets.
    expect(steps.some(isFallbackIf)).toBe(true);
    const rules = collectRules(op.pipeline.steps);
    const bareDateGate = rules.find(r => r.comparator === "DATE_IN_PERIOD" && r.right === "$goalPeriod");
    expect(bareDateGate).toBeTruthy();
  });

  it("drops the $goalPeriod fallbacks so an empty page filter stays EMPTY", () => {
    const op = makeTrackerOp(trackerArgs);
    const changed = applyPeriodAllPolicy([op]);
    expect(changed.length).toBe(1);
    const steps = collectSteps(op.pipeline.steps);
    expect(steps.some(isFallbackIf)).toBe(false);
  });

  it("wraps every DATE_IN_PERIOD $goalPeriod rule in an OR with $goalPeriod IS_EMPTY", () => {
    const op = makeTrackerOp(trackerArgs);
    applyPeriodAllPolicy([op]);
    const rules = collectRules(op.pipeline.steps);
    // No bare DATE_IN_PERIOD $goalPeriod survives outside a period-all OR.
    const orGroups = rules.filter(r =>
      r.operator === "OR"
      && r.rules?.some(x => x.comparator === "DATE_IN_PERIOD" && x.right === "$goalPeriod")
      && r.rules?.some(x => x.left === "$goalPeriod" && x.comparator === "IS_EMPTY"));
    expect(orGroups.length).toBeGreaterThan(0);
    // Every DATE_IN_PERIOD $goalPeriod now lives INSIDE such an OR group.
    const dateGates = rules.filter(r => r.comparator === "DATE_IN_PERIOD" && r.right === "$goalPeriod");
    for (const g of dateGates) {
      const parent = orGroups.find(o => o.rules.includes(g));
      expect(parent).toBeTruthy();
    }
  });

  it("is idempotent — a second pass changes nothing", () => {
    const op = makeTrackerOp(trackerArgs);
    applyPeriodAllPolicy([op]);
    const secondPass = applyPeriodAllPolicy([op]);
    expect(secondPass.length).toBe(0);
  });

  it("leaves a lifetime tracker (timeFilter:'all', no $goalPeriod) untouched", () => {
    const op = makeTrackerOp({ ...trackerArgs, name: "Total Reading Time", agg: "sum", timeFilter: "all" });
    const changed = applyPeriodAllPolicy([op]);
    expect(changed.length).toBe(0);
  });
});
