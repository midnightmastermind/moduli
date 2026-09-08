// The cut-off has to come from the TILE's own filter, not its op's page.
//
// `0324` gave a balance a cut-off and took it from `$activePeriodEnd` — which
// the executor derives from the OPERATION's `targetOccurrenceId`, i.e. the page
// the op is pointed at. **That is a different period from the one the tracker
// tile is filtered to**, and the difference is not academic: with the tile
// filtered to a quiet day AFTER the baseline every filtered case still read the
// unfiltered number, because the op's page had not moved.
//
//     current, filtered to a quiet day AFTER the baseline   got 90, want 100
//     current, filtered to the day it was SET               got 90, want 100
//     current, filtered BEFORE the baseline was ever set     got 90, want 0
//
// `$goalPeriod` is the tile's OWN effective filter — every tracker already
// binds it, and it is what `DATE_IN_PERIOD` reads on every other row gate. So
// the fix is one rule against one var, with the arithmetic moved into a
// comparator (`DATE_ON_OR_BEFORE_PERIOD`) rather than expressed as an OR-group
// of three:
//
//     $item.fields.<Date>.value  DATE_ON_OR_BEFORE_PERIOD  $goalPeriod
//
// An empty period passes (no filter, no cut-off), which is the wildcard arm the
// old group spelled out by hand.
//
// PATCHES, like `0324` — these four ops carry work from `0298`/`0299`/`0164`/
// `0313` and regenerating them would drop all of it. It refuses if it finds no
// gate to swap in an op it believes is a balance.
//
// Idempotent.
import Field from "../models/Field.js";
import Operation from "../models/Operation.js";

export const id = "0325-a-balance-follows-the-tile-not-the-page";
export const description = "A balance's cut-off comes from the tile's own filter (`$goalPeriod`), not its op's page.";
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

  // `0324`'s shape, recognised exactly: the three-rule OR against the PAGE's end.
  const isPageGate = (n) =>
    n && n.operator === "OR" && Array.isArray(n.rules) && n.rules.length === 3 &&
    n.rules.some((r) => r.left === "$activePeriodEnd" && r.comparator === "IS_EMPTY") &&
    n.rules.some((r) => r.left === gateLeft && r.comparator === "DATE_BEFORE" && r.right === "$activePeriodEnd") &&
    n.rules.some((r) => r.left === gateLeft && r.comparator === "SAME_DAY"    && r.right === "$activePeriodEnd");

  const tileGate = () => ({
    id: rid(), left: gateLeft, comparator: "DATE_ON_OR_BEFORE_PERIOD", right: "$goalPeriod",
  });

  let changed = 0, alreadyDone = 0;
  for (const op of ops.filter((o) => o.enabled !== false)) {
    const json = JSON.stringify(op.pipeline || {});
    if (!json.includes("$baseDate")) continue;                 // not a balance
    if (!json.includes("$activePeriodEnd")) {
      if (json.includes("DATE_ON_OR_BEFORE_PERIOD")) { alreadyDone++; log(`  ${op.name}: already reads the tile's own period`); }
      continue;
    }
    // A balance that never binds `$goalPeriod` has no tile filter to read, and
    // swapping its gate would silently remove the cut-off rather than move it.
    if (!json.includes("$goalPeriod"))
      throw new Error(`"${op.name}" carries a page cut-off but binds no $goalPeriod - refusing`);

    let n = 0;
    const swap = (node) => {
      if (Array.isArray(node)) return node.forEach(swap);
      if (!node || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node)) {
        if (Array.isArray(v)) {
          for (let i = 0; i < v.length; i++) {
            if (isPageGate(v[i])) { v[i] = tileGate(); n++; }
            else swap(v[i]);
          }
        } else if (v && typeof v === "object") {
          if (isPageGate(v)) { node[k] = tileGate(); n++; } else swap(v);
        }
      }
    };
    swap(op.pipeline);

    if (!n) throw new Error(`"${op.name}" names $activePeriodEnd but carries no gate in 0324's shape - refusing`);
    if (JSON.stringify(op.pipeline).includes("$activePeriodEnd"))
      throw new Error(`"${op.name}" still names $activePeriodEnd after the swap - refusing`);

    log(`  ${op.name}: ${n} row gate(s) -> DATE_ON_OR_BEFORE_PERIOD $goalPeriod`);
    if (apply) await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { pipeline: op.pipeline } });
    changed++;
  }

  // THE CONTROL, same as `0324`'s: the TRIGGER gates share the row gates' shape,
  // and widening one fires an op on writes it has nothing to do with.
  if (apply) {
    const after = await Operation.find({ gridId: gid }).lean();
    let triggerGates = 0, strays = 0;
    for (const op of after.filter((o) => o.enabled !== false)) {
      walk(op.pipeline, (n) => {
        if (n.comparator === "DATE_IN_PERIOD" && String(n.left || "").startsWith("$trigger.")) triggerGates++;
      });
      if (JSON.stringify(op.pipeline || {}).includes("$activePeriodEnd")) strays++;
    }
    if (!triggerGates) throw new Error(`every trigger date gate disappeared - refusing`);
    if (strays) throw new Error(`${strays} op(s) still name $activePeriodEnd - refusing`);
    log(`  ${triggerGates} trigger gate(s) untouched; 0 ops left on the page's period.`);
  }

  log(`  ${changed} balance op(s) ${apply ? "updated" : "would be updated"}${alreadyDone ? `, ${alreadyDone} already done` : ""}.`);
  if (!apply) log("  DRY RUN - pass --apply to write.");
}
