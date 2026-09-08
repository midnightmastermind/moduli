// `Aggregation` stops describing the arithmetic and starts DECIDING it.
//
// User, 2026-09-08: *"something called aggregation. total and current would be
// the values. that would determine if we use 0 as the baseline or set"* — the
// field is the switch, not a label for one.
//
//     current   start from the last `replace`, apply everything after it
//               -> what you HAVE.   A date filter is a CUT-OFF.
//     total     start at 0, add up the movement, ignore any baseline
//               -> what MOVED.      A date filter is a WINDOW.
//
// `0323` added the field and classified every tracker; `0324`-`0326` made the
// cut-off work. Until now nothing READ the field at run time — the arithmetic
// was still decided by `supportsReplace`, baked into the pipeline at seed time.
// So the classification was a comment. This makes it the switch: flipping the
// Accounts tile to `total` changes what the four balances mean, with no
// migration and no deploy.
//
// ── THREE EDITS PER OP, AND EACH ONE IS HALF THE ANSWER ───────────────────
//
//   1. bind   `$agg = $goalItem.fields.<Aggregation>.value`
//   2. gate   `(agg≠total AND cut-off) OR (agg=total AND window) OR (no period)`
//   3. skip   the baseline scan when `agg = total`
//
// (3) is what makes `total` start at ZERO. Skipping the scan leaves `$baseDate`
// empty, which is exactly the state `replaceGuardRules` already reads as "count
// everything" — so the movement loops need no second branch of their own. Doing
// (2) without (3) would window the rows and still seed the accumulator with the
// baseline: a plausible number that is neither reading.
//
// ── ANYTHING THAT IS NOT THE STRING "total" READS AS `current` ────────────
//
// Deliberate, and it is the whole back-compat story: a tile with no value keeps
// today's behaviour, so this cannot change a tracker nobody has classified. The
// `IS_NOT "total"` arm is what encodes that — inverting it to `IS "current"`
// would silently zero every unstamped tracker.
//
// PATCHES IN PLACE, like `0324`-`0326`: these four ops carry work from
// `0298`/`0299`/`0164`/`0313` and regenerating them from the builder would drop
// it. Refuses on anything it does not recognise. Idempotent.
import Field from "../models/Field.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0327-the-tile-decides-current-or-total";
export const description = "A balance reads its tile's `Aggregation` to decide baseline-vs-zero and cut-off-vs-window.";
export const touches = ["fields", "occurrences", "operations"];

const rid = () => "a" + Math.random().toString(36).slice(2, 11);

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
  const gateLeft = `$item.fields.${dateF}.value`;

  // A tile must actually CARRY the field, or the gate reads an empty var on
  // every row and the whole change is inert while every log line reads fine.
  const stamped = occs.filter((o) => o.fields?.[aggF]?.value).length;
  if (!stamped) throw new Error(`no occurrence carries an Aggregation value - run 0323 first; refusing`);

  // `0326`'s shape: (cut-off) OR (period IS_EMPTY).
  const isCutoffWrapper = (n) =>
    n && Array.isArray(n.rules) && n.operator === "OR" && n.rules.length === 2
    && n.rules.some((r) => r && r.left === gateLeft
        && r.comparator === "DATE_ON_OR_BEFORE_PERIOD" && r.right === "$goalPeriod")
    && n.rules.some((r) => r && r.left === "$goalPeriod" && r.comparator === "IS_EMPTY");

  const twoBranchGate = () => ({
    id: rid(), operator: "OR", rules: [
      { id: rid(), operator: "AND", rules: [
        { id: rid(), left: "$agg", comparator: "IS_NOT", right: "total" },
        { id: rid(), left: gateLeft, comparator: "DATE_ON_OR_BEFORE_PERIOD", right: "$goalPeriod" },
      ] },
      { id: rid(), operator: "AND", rules: [
        { id: rid(), left: "$agg", comparator: "IS", right: "total" },
        { id: rid(), left: gateLeft, comparator: "DATE_IN_PERIOD", right: "$goalPeriod" },
      ] },
      { id: rid(), left: "$goalPeriod", comparator: "IS_EMPTY", right: "" },
    ],
  });

  // The baseline scan: the AND group that selects the `replace` rows.
  const isBaselineCond = (n) =>
    n && Array.isArray(n.rules) && n.operator === "AND"
    && n.rules.some((r) => r && r.comparator === "IS" && r.right === "replace"
        && typeof r.left === "string" && r.left.startsWith("$item.fields."));

  let changed = 0, alreadyDone = 0;
  for (const op of ops.filter((o) => o.enabled !== false)) {
    const json = JSON.stringify(op.pipeline || {});
    if (!json.includes("$baseDate")) continue;                    // not a balance
    if (json.includes('"$agg"')) { alreadyDone++; log(`  ${op.name}: already reads its tile's Aggregation`); continue; }
    if (!json.includes("$goalItem"))
      throw new Error(`"${op.name}" is a balance but binds no $goalItem to read the field from - refusing`);

    // 1. BIND — immediately before the `$goalPeriod` INIT_VAR, so the gate and
    //    the baseline scan both see it. Order matters: a var read before it is
    //    bound resolves to its own NAME as a string (the 0325 defect).
    let bound = 0;
    const bind = (steps) => {
      if (!Array.isArray(steps)) return;
      for (let i = 0; i < steps.length; i++) {
        const c = steps[i]?.config || {};
        if (c.type === "INIT_VAR" && c.name === "$goalPeriod" && !bound) {
          steps.splice(i, 0, { id: rid(), type: "action", config: {
            type: "INIT_VAR", name: "$agg", expr: `$goalItem.fields.${aggF}.value` } });
          bound++; i++;
          continue;
        }
        bind(steps[i]?.then); bind(steps[i]?.else); bind(steps[i]?.body || steps[i]?.steps);
      }
    };
    bind(op.pipeline?.steps);
    if (!bound) throw new Error(`"${op.name}": no $goalPeriod INIT_VAR to bind $agg beside - refusing`);

    // 2. GATE
    let gates = 0;
    const swapGates = (node) => {
      if (Array.isArray(node)) return node.forEach(swapGates);
      if (!node || typeof node !== "object") return;
      for (const [k, v] of Object.entries(node)) {
        if (Array.isArray(v)) {
          for (let i = 0; i < v.length; i++) {
            if (isCutoffWrapper(v[i])) { v[i] = twoBranchGate(); gates++; } else swapGates(v[i]);
          }
        } else if (v && typeof v === "object") {
          if (isCutoffWrapper(v)) { node[k] = twoBranchGate(); gates++; } else swapGates(v);
        }
      }
    };
    swapGates(op.pipeline);
    if (!gates) throw new Error(`"${op.name}": no cut-off gate in 0326's shape to convert - refusing`);

    // 3. SKIP THE BASELINE FOR `total`
    let skips = 0;
    walk(op.pipeline, (n) => {
      if (!isBaselineCond(n)) return;
      if (n.rules.some((r) => r && r.left === "$agg")) return;     // idempotent
      n.rules.push({ id: rid(), left: "$agg", comparator: "IS_NOT", right: "total" });
      skips++;
    });
    if (!skips) throw new Error(`"${op.name}": no baseline scan to gate - refusing`);

    log(`  ${op.name}: bound $agg, ${gates} gate(s) -> two branches, ${skips} baseline scan(s) gated`);
    if (apply) await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { pipeline: op.pipeline } });
    changed++;
  }

  // THE CONTROLS. Each is a way this specific change can go wrong quietly.
  if (apply) {
    const after = await Operation.find({ gridId: gid }).lean();
    let bare = 0, triggerGates = 0, unbound = 0;
    for (const op of after.filter((o) => o.enabled !== false)) {
      const json = JSON.stringify(op.pipeline || {});
      // (a) a gate left on the single-branch shape is a tracker the field
      //     cannot reach — inert, and indistinguishable from working.
      walk(op.pipeline, (n) => { if (isCutoffWrapper(n)) bare++; });
      // (b) `$agg` READ but never BOUND resolves to the string "$agg" and the
      //     `IS_NOT "total"` arm then passes for the wrong reason.
      if (json.includes('"$agg"') && !json.includes('"name":"$agg"')) unbound++;
      // (c) the trigger gates share the row gates' shape; widening one fires
      //     the op on writes it has nothing to do with.
      walk(op.pipeline, (n) => {
        if (n.comparator === "DATE_IN_PERIOD" && String(n.left || "").startsWith("$trigger.")) triggerGates++;
      });
    }
    if (bare) throw new Error(`${bare} gate(s) still single-branch - refusing`);
    if (unbound) throw new Error(`${unbound} op(s) read $agg without binding it - refusing`);
    if (!triggerGates) throw new Error(`every trigger date gate disappeared - refusing`);
    log(`  0 single-branch gates, 0 unbound $agg, ${triggerGates} trigger gate(s) untouched.`);
  }

  log(`  ${changed} balance op(s) ${apply ? "updated" : "would be updated"}${alreadyDone ? `, ${alreadyDone} already done` : ""}.`);
  if (!apply) log("  DRY RUN - pass --apply to write.");
}
