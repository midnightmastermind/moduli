/**
 * 0196 — three trackers start obeying the date filter on the page they live on.
 *
 * USER, 2026-08-21: *"audit all my trackers and make sure they are updated and everything is
 * updated when i select a new date filter in the respective spots"*, and on the audit's finding:
 * **"Follow the page filter"**.
 *
 * ── THE AUDIT ───────────────────────────────────────────────────────────────────────────────
 *
 * 30 tracker ops write 82 display values, every one onto the Trackers page. Classified by the date
 * mechanism each ACTUALLY uses rather than by its name:
 *
 *     24  follow the page filter    $goalPeriod, all sourced from _effectiveFilter — 0 exceptions
 *      2  legitimately period-free  Net Worth (a balance), Current Streak (walks history)
 *      2  WALL CLOCK                Fitness: Today's Prescription · Workouts: Today's Session
 *      2  no date rule at all       Nutrition: Today's Micronutrients · Bills: Paid This Month
 *
 * This migration fixes three of the four. `Bills` is NOT one of them — see the bottom.
 *
 * ── THE TWO SHAPES, AND WHY ONE PATTERN DOES NOT FIT BOTH ───────────────────────────────────
 *
 * The healthy 24 gate a LOOP with an OR group, and the second arm is load-bearing:
 *
 *     OR [ $item.fields.<Date>.value DATE_IN_PERIOD $goalPeriod ,  $goalPeriod IS_EMPTY ]
 *
 * It fails OPEN: with no filter set the tracker counts everything rather than nothing.
 * `Nutrition: Today's Micronutrients` takes exactly that, because it loops meal rows — and those
 * rows carry their own Date (measured: 8 of 8), so the rule has something to test.
 *
 * **Copying it onto the other two would be wrong.** They do not loop; they FIND the day column:
 *
 *     FIND $allContainers WHERE Schedule Format IS "day-col" AND Date SAME_DAY "$today"
 *
 * A FIND that matches several rows binds an ARRAY, and UPDATE throws `not a record` on one — the
 * 2026-08-11 (4) defect. So an `IS_EMPTY` arm that matches EVERY day column would turn a silent
 * wrong answer into a crash. Their fallback is `SAME_DAY $today` instead: with no filter they keep
 * doing exactly what they do today.
 *
 * ── WHAT IS NOT FIXED, AND IT IS THE BIGGER FINDING ─────────────────────────────────────────
 *
 * `Bills: Paid This Month` has no date rule either, and adding one would be filtering a query that
 * already returns nothing: its predicate requires `Completed IS true` and **0 of the 11 bills bind
 * `Completed` at all**. The tile reads 0 forever and there is no way to mark a bill paid in the UI.
 * That is the `0184` class from the predicate side, and it means the *"vs what i paid so far"* half
 * of the Monthly Bills ask has never worked. Binding a checkbox onto eleven live rows is a product
 * change, not an audit fix, so it is reported rather than guessed at.
 *
 * ── HONEST LIMIT ────────────────────────────────────────────────────────────────────────────
 *
 * The page filter is a bare date string today (`{"Eh7oi4HKdbHB":"2026-08-22"}`), so DATE_IN_PERIOD
 * matches exactly one day column. If a multi-day RANGE is ever picked on the Trackers page, the two
 * FIND-based ops could match several columns and throw. A single-day readout has no meaning over a
 * range, so that is a scope limit rather than a bug — stated here so the next person is not
 * surprised by it.
 */
const DATE = "Eh7oi4HKdbHB";
const uid = () => Math.random().toString(36).slice(2, 12);

export const id = "0196-three-trackers-follow-the-page-filter";
export const describe =
  "Micronutrients gates its meal loop on the page's date period; the two Today's-workout trackers resolve their day column from the filter instead of the wall clock, falling back to today.";

/** The loop-gate arm the healthy 24 use: in-period, or no filter at all. */
export function periodOrUnfiltered(dateFieldId = DATE) {
  return { id: uid(), operator: "OR", rules: [
    { id: uid(), left: `$item.fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
    { id: uid(), left: "$goalPeriod", comparator: "IS_EMPTY", right: "" },
  ] };
}

/** The FIND arm: the filter's day, or — with no filter — today. Never both, never all. */
export function periodOrToday(dateFieldId = DATE) {
  return { id: uid(), operator: "OR", rules: [
    { id: uid(), left: `fields.${dateFieldId}.value`, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
    { id: uid(), operator: "AND", rules: [
      { id: uid(), left: "$goalPeriod", comparator: "IS_EMPTY", right: "" },
      { id: uid(), left: `fields.${dateFieldId}.value`, comparator: "SAME_DAY", right: "$today" },
    ] },
  ] };
}

/**
 * Insert `INIT_VAR $goalPeriod` right after the step that binds `tileVar`.
 *
 * **`type: "action"` AT THE STEP LEVEL IS LOAD-BEARING.** The first version of
 * this migration emitted `{ id, config }` only. Every stored step carries
 * `{ id, type: "action", config }`, and the executor SKIPS a step without it —
 * silently, with no log entry at all. The migration applied, reported
 * `bound=1`, wrote a pipeline that reads correctly, and did nothing: the var
 * never existed, so every gate fell through its own fail-open arm and all three
 * trackers behaved exactly as before. Found only by reading the executor's run
 * log and noticing the step was missing from it.
 *
 * It also REPAIRS an existing `$goalPeriod` step that lacks the key, so the
 * botched first apply heals on a forced re-run rather than needing 0197.
 */
export function bindPeriod(pipeline, tileVar, dateFieldId = DATE) {
  const steps = pipeline?.steps || [];
  const existing = steps.find((s) => s?.config?.name === "$goalPeriod");
  if (existing) {
    if (existing.type === "action") return 0;        // already bound, and runnable
    existing.type = "action";                        // bound but INERT — repair it
    return 1;
  }
  const at = steps.findIndex((s) => s?.config?.type === "INIT_VAR" && s.config.name === tileVar);
  if (at < 0) return 0;
  steps.splice(at + 1, 0, { id: uid(), type: "action", config: {
    type: "INIT_VAR", name: "$goalPeriod", expr: `${tileVar}._effectiveFilter.${dateFieldId}` } });
  return 1;
}

/** Replace a `Date SAME_DAY "$today"` rule wherever it appears, at any depth. */
export function replaceTodayRule(node, replacement, dateFieldId = DATE) {
  let n = 0;
  const visit = (group) => {
    if (!group?.rules) return;
    for (let i = 0; i < group.rules.length; i++) {
      const r = group.rules[i];
      if (r?.left === `fields.${dateFieldId}.value` && r.comparator === "SAME_DAY" && r.right === "$today") {
        group.rules[i] = replacement; n++;
      } else visit(r);
    }
  };
  const walk = (steps) => { for (const s of steps || []) {
    visit(s.condition); visit(s.config?.predicate);
    walk(s.then); walk(s.else); walk(s.body); } };
  walk(node?.steps);
  return n;
}

/** Add the loop gate to the FIRST condition group that scopes on an ancestor. */
export function gateLoop(pipeline, rule) {
  let n = 0;
  const walk = (steps) => { for (const s of steps || []) {
    const rules = s.condition?.rules;
    if (rules && !n && rules.some((r) => r?.comparator === "HAS_ANCESTOR")) { rules.push(rule); n++; }
    walk(s.then); walk(s.else); walk(s.body); } };
  walk(pipeline?.steps);
  return n;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const ops = await Operation.find({ gridId }).lean();
  const plan = [];

  const micro = ops.find((o) => o.name === "Nutrition: Today's Micronutrients");
  if (micro) {
    const p = JSON.parse(JSON.stringify(micro.pipeline));
    const bound = bindPeriod(p, "$tile");
    const gated = gateLoop(p, periodOrUnfiltered());
    if (bound || gated) plan.push({ op: micro, p, note: `bound=${bound} loopGate=${gated}` });
    else log("  Micronutrients: already gated — nothing to do");
  }
  for (const [name, tileVar] of [["Fitness: Today's Prescription", "$goalItem"],
                                 ["Workouts: Today's Session", "$tile"]]) {
    const op = ops.find((o) => o.name === name);
    if (!op) { log(`  REFUSING: no operation named ${name}`); continue; }
    const p = JSON.parse(JSON.stringify(op.pipeline));
    const bound = bindPeriod(p, tileVar);
    const swapped = replaceTodayRule(p, periodOrToday());
    if (!swapped) { log(`  ${name}: no \`Date SAME_DAY $today\` rule found — SKIPPED rather than guessed`); continue; }
    plan.push({ op, p, note: `bound=${bound} todayRulesReplaced=${swapped}` });
  }
  if (!plan.length) { log("  nothing to do"); return; }
  for (const x of plan) log(`  ${x.op.name}: ${x.note}`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }
  for (const x of plan) await Operation.updateOne({ id: x.op.id, gridId }, { $set: { pipeline: x.p } });
  log(`  done — ${plan.length} operation(s) now read the page filter`);
}
