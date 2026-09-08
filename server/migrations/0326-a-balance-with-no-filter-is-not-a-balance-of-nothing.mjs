// `0325` collapsed a gate group to one rule and took the wildcard arm with it.
//
// Every tracker date gate on this grid is shaped
// `(date … $goalPeriod) OR ($goalPeriod IS_EMPTY)` — 111 of them, put there by
// `periodAllPolicy`. `0325` replaced `0324`'s three-rule group with the single
// `DATE_ON_OR_BEFORE_PERIOD` rule, reading that second arm as redundant because
// the new comparator answers TRUE for an absent period.
//
// IT NEVER SEES AN ABSENT PERIOD. `evalRule` resolves a rule's right as
// `resolveExpr(right) ?? right`, so an UNBOUND `$goalPeriod` — which is exactly
// what an unfiltered tile has — arrives as the literal string `"$goalPeriod"`.
// That is not a date, so the cut-off rejected every row:
//
//     balance set to 100 on Sep 1, 10 spent today, tile NOT filtered
//       before 0325   90    correct
//       after  0325    0    every row rejected
//
// Measured, not inferred: instrumenting the comparator showed 96 evaluations,
// every one receiving `right: "$goalPeriod"` as a bare string.
//
// So the arm goes back. `DATE_IN_PERIOD` has the identical exposure, which is
// why the wrapper exists at all — this restores the convention rather than
// inventing a second one.
//
// PATCHES IN PLACE, like `0324`/`0325` — these four ops carry work from
// `0298`/`0299`/`0164`/`0313` and regenerating them would drop it. Refuses if
// an op it believes is a balance carries no bare cut-off to wrap.
//
// Idempotent: a gate already wrapped is left alone.
import Field from "../models/Field.js";
import Operation from "../models/Operation.js";

export const id = "0326-a-balance-with-no-filter-is-not-a-balance-of-nothing";
export const description = "Restore the `$goalPeriod IS_EMPTY` arm 0325 dropped from the balance cut-off gates.";
export const touches = ["fields", "operations"];

const rid = () => "p" + Math.random().toString(36).slice(2, 11);

const walk = (n, fn) => {
  if (Array.isArray(n)) return n.forEach((x) => walk(x, fn));
  if (n && typeof n === "object") { fn(n); Object.values(n).forEach((v) => walk(v, fn)); }
};

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const ops    = await Operation.find({ gridId: gid }).lean();

  const one = (name) => {
    const hits = fields.filter((f) => f.name === name);
    if (hits.length !== 1) throw new Error(`field "${name}" is ambiguous or missing (${hits.length}) - refusing`);
    return hits[0];
  };
  const dateF = one("Date").id;
  const gateLeft = `$item.fields.${dateF}.value`;

  // A BARE cut-off: the rule `0325` left behind, not yet inside a wildcard OR.
  const isBareCutoff = (r) =>
    r && !Array.isArray(r.rules)
    && r.left === gateLeft && r.comparator === "DATE_ON_OR_BEFORE_PERIOD"
    && r.right === "$goalPeriod";

  // Already done: the OR carrying the cut-off AND the empty-period arm.
  const isWrapped = (n) =>
    n && Array.isArray(n.rules) && n.operator === "OR"
    && n.rules.some(isBareCutoff)
    && n.rules.some((x) => x && x.left === "$goalPeriod" && x.comparator === "IS_EMPTY");

  const wrap = (r) => ({
    id: rid(), operator: "OR", rules: [
      { ...r },
      { id: rid(), left: "$goalPeriod", comparator: "IS_EMPTY", right: "" },
    ],
  });

  let changed = 0, alreadyDone = 0;
  for (const op of ops.filter((o) => o.enabled !== false)) {
    const json = JSON.stringify(op.pipeline || {});
    if (!json.includes("DATE_ON_OR_BEFORE_PERIOD")) continue;   // not a cut-off balance

    let wrappedAlready = 0;
    walk(op.pipeline, (n) => { if (isWrapped(n)) wrappedAlready++; });

    let n = 0;
    const swap = (node) => {
      if (Array.isArray(node)) return node.forEach(swap);
      if (!node || typeof node !== "object") return;
      // NEVER descend into a group that is already the wildcard wrapper —
      // wrapping its own cut-off again would nest ORs forever on a re-run.
      if (isWrapped(node)) return;
      for (const [k, v] of Object.entries(node)) {
        if (Array.isArray(v)) {
          for (let i = 0; i < v.length; i++) {
            if (isBareCutoff(v[i])) { v[i] = wrap(v[i]); n++; }
            else swap(v[i]);
          }
        } else if (v && typeof v === "object") {
          if (isBareCutoff(v)) { node[k] = wrap(v); n++; } else swap(v);
        }
      }
    };
    swap(op.pipeline);

    if (!n) {
      if (wrappedAlready) { alreadyDone++; log(`  ${op.name}: ${wrappedAlready} gate(s) already carry the empty-period arm`); continue; }
      throw new Error(`"${op.name}" uses the cut-off but carries no bare gate to wrap - refusing`);
    }
    log(`  ${op.name}: ${n} gate(s) -> (cut-off) OR ($goalPeriod IS_EMPTY)`);
    if (apply) await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { pipeline: op.pipeline } });
    changed++;
  }

  // THE CONTROL. Two things must hold afterwards, and each is a way this has
  // already gone wrong once: every cut-off is inside a wildcard OR (or an
  // unfiltered balance reads 0 again), and the trigger gates are untouched
  // (they share the row gates' shape, and widening one fires the op on writes
  // it has nothing to do with).
  if (apply) {
    const after = await Operation.find({ gridId: gid }).lean();
    let bare = 0, wrapped = 0, triggerGates = 0;
    for (const op of after.filter((o) => o.enabled !== false)) {
      const seenWrapped = new Set();
      walk(op.pipeline, (n) => {
        if (isWrapped(n)) { wrapped++; n.rules.filter(isBareCutoff).forEach((r) => seenWrapped.add(r.id)); }
      });
      walk(op.pipeline, (n) => {
        if (isBareCutoff(n) && !seenWrapped.has(n.id)) bare++;
        if (n.comparator === "DATE_IN_PERIOD" && String(n.left || "").startsWith("$trigger.")) triggerGates++;
      });
    }
    if (bare) throw new Error(`${bare} cut-off gate(s) still bare - refusing`);
    if (!triggerGates) throw new Error(`every trigger date gate disappeared - refusing`);
    log(`  ${wrapped} wrapped cut-off(s), 0 bare; ${triggerGates} trigger gate(s) untouched.`);
  }

  log(`  ${changed} balance op(s) ${apply ? "updated" : "would be updated"}${alreadyDone ? `, ${alreadyDone} already done` : ""}.`);
  if (!apply) log("  DRY RUN - pass --apply to write.");
}
