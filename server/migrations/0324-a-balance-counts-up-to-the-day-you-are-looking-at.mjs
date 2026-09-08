// A balance filtered to a day showed that day's CHANGE, not the balance.
//
// User, 2026-09-08: *"the current vs total thing is more for the nondate but
// since we would have it set either way, it would determine if its a current up
// through that day we set or total for that day."*
//
//                 no date filter          date filter = D
//     current     the balance now         the balance AS OF THE END OF D
//     total       all movement, from 0    movement in D, from 0
//
// `0323` recorded which trackers are which. This makes the arithmetic follow.
//
// ── WHAT WAS WRONG ────────────────────────────────────────────────────────
//
// Every tracker gated its rows with `DATE_IN_PERIOD $goalPeriod` — "did this
// happen in view". Correct for a SUM. Wrong for a BALANCE, measured:
//
//     balance set to 100 on Sep 1, 10 spent today
//       no filter          ->  90   correct
//       filtered to today  -> -10   the day's CHANGE reported as the balance
//       filtered to Sep 5  ->   0   an account that plainly held 100
//
// A balance wants a CUT-OFF, not a window: everything up to and including the
// end of the period. `$activePeriodEnd` is that day, added to the executor
// beside `$activePeriodDates` — deriving it inside a pipeline would mean
// maxing date STRINGS through numeric aggregates that coerce them to NaN.
//
// ── PATCHED, NOT REGENERATED, and that is the whole risk of this file ─────
//
// These four operations carry work from a dozen earlier migrations — the
// per-account gating of `0298`, the transfer legs of `0299`, the category axis
// of `0164`, the write removed by `0313`. Rebuilding them from the builder
// would silently drop all of it. So this rewrites ONE rule shape in place and
// refuses if the count it finds is not the count it expects.
//
// **Only the `$item` gates change.** The same shape appears on
// `$trigger.occurrence` — that is the op's TRIGGER filter, deciding whether to
// run at all, and widening it would fire these ops on unrelated writes.
//
// Idempotent.
import Field from "../models/Field.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0324-a-balance-counts-up-to-the-day-you-are-looking-at";
export const description = "A `current` tracker counts up to the end of the filtered period.";
export const touches = ["fields", "occurrences", "operations"];

const rid = () => "p" + Math.random().toString(36).slice(2, 11);

const walk = (n, fn) => {
  if (Array.isArray(n)) return n.forEach((x) => walk(x, fn));
  if (n && typeof n === "object") { fn(n); Object.values(n).forEach((v) => walk(v, fn)); }
};

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const occs   = await Occurrence.find({ gridId: gid }).lean();
  const ops    = await Operation.find({ gridId: gid }).lean();

  const one = (name) => {
    const hits = fields.filter((f) => f.name === name);
    if (hits.length !== 1) throw new Error(`field "${name}" is ambiguous or missing (${hits.length}) - refusing`);
    return hits[0];
  };
  const dateF = one("Date").id;
  const aggF  = one("Aggregation").id;

  // The trackers that ARE running balances — the ones `0323` marked `current`.
  const currentTiles = new Set(occs
    .filter((o) => o.fields?.[aggF]?.value === "current").map((o) => o.id));
  if (!currentTiles.size)
    throw new Error(`no tracker is marked "current" - run 0323 first; refusing`);

  const gateLeft = `$item.fields.${dateF}.value`;
  const isOldGate = (n) =>
    n && n.operator === "OR" && Array.isArray(n.rules) && n.rules.length === 2 &&
    n.rules.some((r) => r.left === gateLeft && r.comparator === "DATE_IN_PERIOD") &&
    n.rules.some((r) => r.left === "$goalPeriod" && r.comparator === "IS_EMPTY");

  const newGate = () => ({
    id: rid(), operator: "OR", rules: [
      { id: rid(), left: "$activePeriodEnd", comparator: "IS_EMPTY", right: "" },
      { id: rid(), left: gateLeft, comparator: "DATE_BEFORE", right: "$activePeriodEnd" },
      { id: rid(), left: gateLeft, comparator: "SAME_DAY",    right: "$activePeriodEnd" },
    ],
  });

  let changed = 0, alreadyDone = 0;
  for (const op of ops.filter((o) => o.enabled !== false)) {
    // Does this op write a `current` tile? Found by the tile it binds.
    let writesCurrent = false;
    walk(op.pipeline, (n) => {
      const c = n.config || {};
      if (c.type !== "INIT_VAR" || typeof c.expr !== "string") return;
      const m = /^\$allItemsById\.([A-Za-z0-9_-]+)$/.exec(c.expr);
      if (m && currentTiles.has(m[1])) writesCurrent = true;
    });
    if (!writesCurrent) continue;

    // A `current` op with no baseline scan is not a balance — Net Worth SUMS
    // the balances, and rewriting its window would double-apply the cut-off.
    if (!JSON.stringify(op.pipeline || {}).includes("$baseDate")) {
      log(`  ${op.name}: marked current but does no baseline scan — left alone (it reads balances, it is not one)`);
      continue;
    }

    if (JSON.stringify(op.pipeline).includes("$activePeriodEnd")) { alreadyDone++; log(`  ${op.name}: already counts up to the period end`); continue; }

    let n = 0;
    const swap = (node) => {
      if (Array.isArray(node)) return node.forEach(swap);
      if (!node || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node)) {
        if (Array.isArray(v)) {
          for (let i = 0; i < v.length; i++) {
            if (isOldGate(v[i])) { v[i] = newGate(); n++; }
            else swap(v[i]);
          }
        } else if (v && typeof v === "object") {
          if (isOldGate(v)) { node[k] = newGate(); n++; } else swap(v);
        }
      }
    };
    swap(op.pipeline);

    if (!n) throw new Error(`"${op.name}" is a balance but carries no $item date gate - refusing`);
    log(`  ${op.name}: ${n} row gate(s) -> on or before $activePeriodEnd`);
    if (apply) await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { pipeline: op.pipeline } });
    changed++;
  }

  // THE CONTROL: the TRIGGER gates must be untouched. They share the shape, and
  // widening one fires the op on writes it has nothing to do with.
  if (apply) {
    const after = await Operation.find({ gridId: gid }).lean();
    let triggerGates = 0;
    for (const op of after.filter((o) => o.enabled !== false))
      walk(op.pipeline, (n) => {
        if (n.comparator === "DATE_IN_PERIOD" && String(n.left || "").startsWith("$trigger.")) triggerGates++;
      });
    if (!triggerGates) throw new Error(`every trigger date gate disappeared - refusing`);
    log(`  ${triggerGates} trigger gate(s) untouched.`);
  }

  log(`  ${changed} balance op(s) ${apply ? "updated" : "would be updated"}${alreadyDone ? `, ${alreadyDone} already done` : ""}.`);
  if (!apply) log("  DRY RUN - pass --apply to write.");
}
