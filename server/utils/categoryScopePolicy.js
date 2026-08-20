// server/utils/categoryScopePolicy.js
//
// THE SECOND AXIS. The original vision is "sum/count/track progress across any
// time window AND category". The time window has worked for months; the category
// half has never existed — measured 2026-08-20, **0 of 29 tracker ops referenced
// any category field**, so "how many PHYSICAL tasks did I complete this week?"
// had no answer.
//
// IT ADDS NO MECHANISM. Every piece of this is what the trackers already do for
// the DATE, one field over:
//
//   date      INIT_VAR $goalPeriod   = $goalItem._effectiveFilter.<dateFieldId>
//             rule     $item.fields.<dateFieldId>.value DATE_IN_PERIOD $goalPeriod
//   category  INIT_VAR $goalCategory = $goalItem._effectiveFilter.<categoryFieldId>
//             rule     $item.fields.<categoryFieldId>.value CONTAINS $goalCategory
//
// The category value is read from the goal tile's OWN effective filter — the same
// cascade (tile → container → page → grid) the date is read from, so a category
// picked on the Trackers page scopes its tiles exactly the way a date does.
//
// THE PREFIX IS TAKEN FROM THE OP'S OWN `$goalPeriod` STEP rather than assumed.
// All 31 live resolutions read `$goalItem._effectiveFilter.<id>`, but reading it
// back off each op means a tracker that resolves its filter from somewhere else
// carries this one with it instead of silently reading a var it never binds.
//
// EMPTY MEANS ALL, which is `periodAllPolicy`'s rule and has to hold here for the
// same reason: the trackers page is normally unfiltered by category, and a bare
// category rule would make every tile read 0 until you picked one. So the gate is
// `(category matches) OR ($goalCategory IS_EMPTY)`.
//
// ONLY THE LOOP GATE, NEVER THE TRIGGER GATE — the distinction that keeps the
// numbers honest. Of the 111 live `DATE_IN_PERIOD $goalPeriod` rules, **42 sit on
// a LOOP variable** (which items aggregate) and **69 on `$trigger.*`** (whether an
// edit re-runs the tracker at all). Only 32 of the 42 are literally named `$item`;
// the other 10 are the hand-written trackers' own loop vars, which is precisely
// why the discriminator below is trigger-vs-loop rather than the name.
//
// Gating the trigger would stop a tracker recomputing when you edit something
// outside the current category — and since the loop already excludes it, the only
// effect would be leaving a STALE number on screen. Recomputing more often than strictly needed is free; recomputing too
// rarely is a wrong number.
//
// Idempotent. Shared by the seed (so a reseed keeps it) and the migration (so the
// live grid gets it) — the same split `periodAllPolicy` uses.

const uid = () => Math.random().toString(36).slice(2, 14);

// A LOOP date gate is any `$<loopVar>.fields.<dateFieldId>.value DATE_IN_PERIOD
// $goalPeriod`. The discriminator is trigger-vs-loop, NOT the variable's name:
// makeTrackerOp calls its loop var `$item`, but the hand-written media and mood
// trackers use `$watchInst` / `$moodInst` / … (2026-07-10). Keying on `$item`
// silently skipped six trackers — Moods, Phone Calls, Movies/Books/Podcasts/
// Courses — which is exactly the half-shipped outcome this repo keeps paying for.
const LOOP_DATE_RX = /^\$([A-Za-z0-9_]+)\.fields\./;
const loopVarOf = (r) => {
  if (!r || typeof r.left !== "string") return null;
  if (r.left.startsWith("$trigger.")) return null;
  const m = LOOP_DATE_RX.exec(r.left);
  return m ? m[1] : null;
};
const isLoopDateRule = (r) =>
  !!loopVarOf(r) && r.comparator === "DATE_IN_PERIOD" && r.right === "$goalPeriod";

// After periodAllPolicy the date rule is wrapped: (date IN period) OR (period IS_EMPTY).
const isPeriodAllWrapper = (r) =>
  r && Array.isArray(r.rules) && r.operator === "OR"
  && r.rules.some(isLoopDateRule)
  && r.rules.some(x => x && x.left === "$goalPeriod" && x.comparator === "IS_EMPTY");

const mentionsGoalCategory = (group) =>
  (group.rules || []).some(r =>
    (r && r.right === "$goalCategory")
    || (r && Array.isArray(r.rules) && r.rules.some(x => x && x.right === "$goalCategory")));

// The gate reads the SAME loop variable the date gate beside it reads. Hardcoding
// `$item` would emit a rule referencing a var that does not exist in six of the
// trackers — and an unbound var throws, so the op would stop firing entirely.
function categoryGate(categoryFieldId, loopVar) {
  return {
    id: uid(),
    operator: "OR",
    rules: [
      { id: uid(), left: `$${loopVar}.fields.${categoryFieldId}.value`, comparator: "CONTAINS", right: "$goalCategory" },
      // Empty = no category picked = aggregate everything, exactly as an empty
      // period does. Without this arm every tile reads 0 on an unfiltered page.
      { id: uid(), left: "$goalCategory", comparator: "IS_EMPTY", right: "" },
    ],
  };
}

// Walks every rule GROUP and adds the category gate beside the loop's date gate.
function addGates(node, categoryFieldId, counter) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach(n => addGates(n, categoryFieldId, counter)); return; }

  if (Array.isArray(node.rules)) {
    // NEVER add the gate INSIDE the period-all wrapper. That group is
    // `(date in period) OR (period IS_EMPTY)`; appending a category arm makes it
    // `… OR (category matches OR category IS_EMPTY)`, and since the category is
    // empty on an unfiltered page the whole group becomes vacuously TRUE — which
    // silently disables date filtering on every tracker. Caught by checking the
    // dry run against a named expectation: it reported 61 gates where the grid
    // has 42 loop date rules, and the extras were all landing in here.
    let loopVar = null;
    if (!isPeriodAllWrapper(node)) {
      for (const r of node.rules) {
        if (isLoopDateRule(r)) { loopVar = loopVarOf(r); break; }
        if (isPeriodAllWrapper(r)) { loopVar = loopVarOf(r.rules.find(isLoopDateRule)); break; }
      }
    }
    if (loopVar && !mentionsGoalCategory(node)) {
      node.rules.push(categoryGate(categoryFieldId, loopVar));
      counter.gates++;
    }
  }
  for (const v of Object.values(node)) addGates(v, categoryFieldId, counter);
}

// Inserts INIT_VAR $goalCategory right after the op's own INIT_VAR $goalPeriod,
// mirroring whatever source that step reads its filter from.
function addCategoryVar(steps, categoryFieldId, counter) {
  if (!Array.isArray(steps)) return;
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s?.then) addCategoryVar(s.then, categoryFieldId, counter);
    if (s?.else) addCategoryVar(s.else, categoryFieldId, counter);
    if (s?.body) addCategoryVar(s.body, categoryFieldId, counter);
    const cfg = s?.config;
    if (cfg?.type !== "INIT_VAR" || cfg.name !== "$goalPeriod") continue;
    const m = /^(.*)\._effectiveFilter\.[A-Za-z0-9_-]+$/.exec(String(cfg.expr || ""));
    if (!m) continue;                                   // a fallback step, not the resolution
    const already = steps.some(x => x?.config?.type === "INIT_VAR" && x.config.name === "$goalCategory");
    if (already) continue;
    steps.splice(i + 1, 0, {
      id: uid(), type: "action",
      config: { type: "INIT_VAR", name: "$goalCategory", expr: `${m[1]}._effectiveFilter.${categoryFieldId}` },
    });
    counter.vars++;
  }
}

export function applyCategoryScope(ops, { categoryFieldId } = {}) {
  if (!categoryFieldId) throw new Error("applyCategoryScope: categoryFieldId is required");
  const changed = [];
  const skipped = [];
  for (const op of ops || []) {
    const json = JSON.stringify(op?.pipeline || {});
    // Same discriminator periodAllPolicy uses: a tracker is an op that resolves
    // a $goalPeriod. Nothing here learns the name of any particular tracker.
    if (!/\$goalPeriod/.test(json)) continue;
    const counter = { vars: 0, gates: 0 };
    addCategoryVar(op.pipeline?.steps, categoryFieldId, counter);
    // FAIL CLOSED. A gate reads `$goalCategory`, and referencing an UNBOUND var
    // throws — so an op we could not bind the var in would stop firing
    // altogether. Six live trackers (Moods, Phone Calls, and the four media
    // ones) resolve their $goalPeriod without an `_effectiveFilter` source, so
    // there is nothing to mirror; they are reported as uncovered rather than
    // silently broken. Losing a category filter on six tiles is a gap. Killing
    // six trackers is a defect.
    // Searched over the WHOLE pipeline, not the top-level steps. `addCategoryVar`
    // recurses into then/else/body, and eight live trackers resolve their
    // $goalPeriod inside a branch — so a top-level `.some` cannot see the binding
    // it just inserted and reports an op it correctly patched as UNCOVERED. Caught
    // by re-running: the skipped list went 6 -> 14 on a converged grid. Benign
    // there (nothing left to add), but it would refuse a genuinely needed gate on
    // the next pass, which is the failure this check exists to prevent.
    const alreadyBound = /"name":"\$goalCategory"/.test(JSON.stringify(op.pipeline || {}));
    if (!counter.vars && !alreadyBound) { skipped.push(op.name || op.id); continue; }
    addGates(op.pipeline?.steps, categoryFieldId, counter);
    if (counter.vars || counter.gates) changed.push({ op, ...counter });
  }
  changed.skipped = skipped;
  return changed;
}

export const __testables = { isLoopDateRule, isPeriodAllWrapper, categoryGate };
