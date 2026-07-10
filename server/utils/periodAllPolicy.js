// server/utils/periodAllPolicy.js
// Policy (user 2026-07-10): a tracker filters by the active period when the
// goals/trackers page has a day selected; when NO day is selected it aggregates
// ALL. Transforms tracker pipelines:
//   1. Drop the `$trigger.date` / `$today` fallbacks on $goalPeriod (both the
//      separate IF-steps makeTrackerOp emits AND the fallback/fallback2 props the
//      inline trackers use) — so $goalPeriod stays EMPTY when the page filter is
//      cleared, instead of silently defaulting to today.
//   2. Wrap every `DATE_IN_PERIOD $goalPeriod` rule in
//      `(that) OR ($goalPeriod IS_EMPTY)` — so an empty period matches ALL items
//      (and all trigger events re-aggregate).
// Idempotent. Shared by createLiveData.js (seed pass) + scripts/patchPeriodAll.js
// (live-DB apply).

const uid = () => Math.random().toString(36).slice(2, 14);

// The IF the seed emits: IF ($goalPeriod IS_EMPTY) THEN $goalPeriod = $trigger.date|$today
function isGoalPeriodFallbackIf(s) {
  const rules = s?.condition?.rules;
  return s?.type === "if"
    && rules?.length === 1
    && rules[0].left === "$goalPeriod" && rules[0].comparator === "IS_EMPTY"
    && (s.then || []).length >= 1
    && s.then.every(a => a?.config?.type === "INIT_VAR" && a.config.name === "$goalPeriod"
        && (a.config.expr === "$trigger.date" || a.config.expr === "$today"));
}

function wrapDateRules(rules, insidePeriodAllOr, counter) {
  if (!Array.isArray(rules)) return;
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (Array.isArray(r.rules)) {
      const isPAO = r.operator === "OR"
        && r.rules.some(x => x.left === "$goalPeriod" && x.comparator === "IS_EMPTY");
      wrapDateRules(r.rules, isPAO, counter);
      continue;
    }
    if (!insidePeriodAllOr && r.comparator === "DATE_IN_PERIOD" && r.right === "$goalPeriod") {
      rules[i] = { id: uid(), operator: "OR", rules: [
        { ...r },
        { id: uid(), left: "$goalPeriod", comparator: "IS_EMPTY", right: "" },
      ] };
      counter.n++;
    }
  }
}

function transformSteps(steps, counter) {
  if (!Array.isArray(steps)) return;
  // 1a. Remove the $trigger.date / $today fallback IF-steps.
  for (let i = steps.length - 1; i >= 0; i--) {
    if (isGoalPeriodFallbackIf(steps[i])) { steps.splice(i, 1); counter.n++; }
  }
  for (const s of steps) {
    // 1b. Strip fallback / fallback2 props on INIT_VAR $goalPeriod (inline trackers).
    if (s.config?.type === "INIT_VAR" && s.config.name === "$goalPeriod") {
      for (const k of ["fallback", "fallback2"]) {
        if (s.config[k] === "$trigger.date" || s.config[k] === "$today") { delete s.config[k]; counter.n++; }
      }
    }
    // 2. Wrap DATE_IN_PERIOD $goalPeriod rules.
    if (s.condition?.rules) wrapDateRules(s.condition.rules, false, counter);
    if (s.config?.predicate?.rules) wrapDateRules(s.config.predicate.rules, false, counter);
    transformSteps(s.then, counter);
    transformSteps(s.else, counter);
    transformSteps(s.body || s.steps, counter);
  }
}

// Mutates each tracker op's pipeline in place; returns the changed op objects.
export function applyPeriodAllPolicy(ops) {
  const changed = [];
  for (const op of ops) {
    if (!JSON.stringify(op.pipeline || {}).includes("$goalPeriod")) continue; // trackers only
    const counter = { n: 0 };
    transformSteps(op.pipeline?.steps, counter);
    if (counter.n > 0) changed.push(op);
  }
  return changed;
}
