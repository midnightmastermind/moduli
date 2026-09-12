// 0331 — a tracker loops over the grid's INSTANCES, not over everything.
//
// Every tracker op walks its rows with `LOOP over $allItems` and then gates each
// row (in scope, dated in the period, completed, carries the field). `$allItems`
// is the WHOLE grid — ~21,000 occurrences, 15,700 of them media artifacts — and
// the rows a tracker counts are instances. `$allInstances` is the role-filtered
// slice the executor already builds once per sweep, so the same gates run over
// ~5% of the rows.
//
// ── ONLY OPS PROVEN EQUIVALENT, by NAME ────────────────────────────────────
//
// Measured on a fresh export of poms grid (2026-09-12) by running each op with
// both collections under five triggers — load, a Completed tick on and off, a
// Trackers navigation, an occurrence create — and comparing the sorted effects.
// A second pass instrumented every `$allItems` loop's first gate to record the
// ROLE of each row that passed it.
//
//     25 ops    identical effects under all 5 triggers, 0 non-instance rows
//               passing a gate
//     Completion Rate         DIFFERS — a container passes its gate; the
//                             denominator counts it
//     Trackers: Media Owned   DIFFERS — it counts artifacts, by design
//
// Load time per op, before -> after, desktop: 10-85ms saved each (Completed
// Tasks 231 -> 146, Savings Balance 244 -> 196, Checking Balance 246 -> 174).
// Small per op; it is paid on every sweep by every tracker.
//
// **The equivalence is a fact about THIS grid's data**, so the op list is named
// rather than derived. A future tracker gets the builder's shape
// (`makeTrackerOp` emits `$allInstances` except for completionRate); an op not
// on this list is not touched.
//
// ── WHAT IT TOUCHES ────────────────────────────────────────────────────────
//
// Only `type:"loop"` steps whose `overExpr` is exactly `"$allItems"`. A FIND over
// `$allItems`, an `INIT_VAR $x = $allItemsById.<id>` and every other reference
// are left alone. Refuses when a named op is missing or ambiguous, and asserts
// the two non-equivalent ops are never in the plan. Idempotent: an op already
// converted has no `$allItems` loop left and is reported as converged.

export const id = "0331-trackers-loop-instances";
export const description = "Tracker loops iterate $allInstances instead of $allItems, for the 25 ops measured equivalent.";
export const touches = ["operations"];

export const EQUIVALENT_OPS = [
  "Completed Tasks", "Steps", "Water", "Time Spent", "Pages",
  "Pomodoros Today", "Pomodoro Time", "Spent", "Earned",
  "Checking Balance", "Mom's Account Balance", "Cash Balance", "Savings Balance",
  "Total Workouts", "Total Reading Time", "Time Spent This Week",
  "Completed Habits", "Sleep Time", "Fitness: Today's Prescription",
  "Connection Time", "Creative Duration", "Practice Duration", "Work Duration",
  "Environment Care", "Coffee",
];

export const NOT_EQUIVALENT = ["Completion Rate", "Trackers: Media Owned"];

const FROM = "$allItems";
const TO = "$allInstances";

function eachStep(steps, fn) {
  for (const s of steps || []) {
    if (!s || typeof s !== "object") continue;
    fn(s);
    for (const k of ["steps", "body", "then", "else"]) if (Array.isArray(s[k])) eachStep(s[k], fn);
  }
}

/** How many loop steps still iterate `$allItems`. */
export function countAllItemsLoops(pipeline) {
  let n = 0;
  eachStep(pipeline?.steps, (s) => { if (s.type === "loop" && s.overExpr === FROM) n++; });
  return n;
}

/** Swap every `$allItems` LOOP in place. Returns the number swapped. */
export function swapLoopsToInstances(pipeline) {
  let n = 0;
  eachStep(pipeline?.steps, (s) => {
    if (s.type === "loop" && s.overExpr === FROM) { s.overExpr = TO; n++; }
  });
  return n;
}

/** Which ops change, which are already done, which named ops are absent. */
export function planSwap(ops) {
  const forbidden = EQUIVALENT_OPS.filter((n) => NOT_EQUIVALENT.includes(n));
  if (forbidden.length) throw new Error(`a non-equivalent op is on the swap list: ${forbidden.join(", ")}`);

  const plan = [], converged = [], missing = [], ambiguous = [];
  for (const name of EQUIVALENT_OPS) {
    const hits = (ops || []).filter((o) => o.name === name);
    if (hits.length === 0) { missing.push(name); continue; }
    if (hits.length > 1) { ambiguous.push(name); continue; }
    const loops = countAllItemsLoops(hits[0].pipeline);
    if (loops === 0) converged.push(name);
    else plan.push({ op: hits[0], loops });
  }
  return { plan, converged, missing, ambiguous };
}

export async function up({ gridId, models, log = console.log, dryRun = true }) {
  const { Operation } = models;
  const ops = await Operation.find({ gridId: String(gridId) }).lean();
  const { plan, converged, missing, ambiguous } = planSwap(ops);

  if (ambiguous.length) throw new Error(`ambiguous op names (more than one match): ${ambiguous.join(", ")} - refusing`);
  if (missing.length) throw new Error(`named ops not on this grid: ${missing.join(", ")} - refusing`);

  const loops = plan.reduce((a, p) => a + p.loops, 0);
  log(`ops to convert: ${plan.length} (${loops} loops) · already converged: ${converged.length} · expected ${EQUIVALENT_OPS.length} in total`);
  for (const { op, loops: n } of plan) log(`  ${op.name}: ${n} loop${n === 1 ? "" : "s"}`);

  if (dryRun || !plan.length) return { changed: 0, planned: plan.length };

  for (const { op } of plan) {
    const next = JSON.parse(JSON.stringify(op.pipeline));
    swapLoopsToInstances(next);
    await Operation.updateOne({ _id: op._id }, { $set: { pipeline: next } });
  }

  // Read the RESULT back, not the log.
  const after = await Operation.find({ gridId: String(gridId) }).lean();
  const left = EQUIVALENT_OPS.filter((n) => countAllItemsLoops(after.find((o) => o.name === n)?.pipeline) > 0);
  if (left.length) throw new Error(`still looping $allItems after the write: ${left.join(", ")}`);
  for (const n of NOT_EQUIVALENT) {
    const before = countAllItemsLoops(ops.find((o) => o.name === n)?.pipeline);
    const now = countAllItemsLoops(after.find((o) => o.name === n)?.pipeline);
    if (before !== now) throw new Error(`"${n}" changed (${before} -> ${now}) and must not have`);
  }
  log(`converted ${plan.length} ops; ${NOT_EQUIVALENT.join(" and ")} untouched`);
  return { changed: plan.length };
}
