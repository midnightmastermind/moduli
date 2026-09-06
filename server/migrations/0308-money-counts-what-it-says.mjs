// Three money defects the user hit in one sitting, 2026-09-06:
//
//   *"networth isnt including cash"*
//   *"income isnt going up when i add to accounts"*
//   *"setting the account numbers is adding those transactions to purchases.
//     it should only be purchases if its negative"*
//
// ── 1. NET WORTH'S THIRD TERM POINTED AT THE WRONG TILE, AND IT IS MINE ────
//
// `0288` made Net Worth "Checking + Savings + Cash, not Mom's". It reads three
// pairs of (templateId, field) - and the third pair names
// `templateId HoTfgN19hapH`, which is **Mom's Account**, while reading a field
// called `Cash` that Mom's Account does not carry. So the term matched nothing:
//
//     Checking  CX0HDHKhxaBm  Checking Balance = 4.16   ok
//     Savings   BpG7oCxRERoy  Savings Balance  = 123.14 ok
//     Cash      HoTfgN19hapH  Cash             = undefined   <- Mom's Account
//     Net Worth = 127.30                                      (4.16 + 123.14)
//
// The real Cash tile is module `NtEOt8ov6wQq`, holding `Cash = 17`. It is not
// hardcoded here: the module is DERIVED as the one binding the same `Cash`
// field the rule already names, and the migration refuses unless exactly one
// module binds it. Net Worth becomes 144.30.
//
// ── 2. A PURCHASE IS MONEY GOING OUT ───────────────────────────────────────
//
// `Purchase History` gates on `Amount IS_NOT_EMPTY` and nothing about
// DIRECTION. Measured across the grid, Amount is used with three flows -
// **out 17, replace 9, in 4** - so setting an account balance (`replace`) and
// receiving money (`in`) both landed in the purchase list. It now requires
// `flow IS out`, which is the user's own rule: only a purchase if it is
// negative.
//
// ── 3. MONEY ARRIVING IN AN ACCOUNT IS INCOME ──────────────────────────────
//
// `Earned` sums the `Income` field only, and exactly ONE occurrence on the grid
// carries an Income value - the `Earn` catalog row. Adding to an account writes
// `Amount` with flow `in`, which no tracker counted. A second loop sums those.
//
// **A TRANSFER IN IS NOT INCOME**, which is the one thing this must not get
// wrong: `0299` made an arrival identifiable by `To Account`, so rows carrying
// one are excluded. Moving $100 from Checking to Savings must not read as $100
// earned. A `replace` is excluded too - correcting a balance is not income -
// and that falls out of requiring flow `in`.
import Field from "../models/Field.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0308-money-counts-what-it-says";
export const description = "Net Worth includes Cash; a purchase is money out; money arriving in an account counts as income.";
export const touches = ["fields", "modules", "occurrences", "operations"];

const rid = () => "m" + Math.random().toString(36).slice(2, 12);

const touchesVar = (grp, v) => Array.isArray(grp?.rules) && grp.rules.some(
  (r) => (Array.isArray(r?.rules) ? touchesVar(r, v) : String(r?.left || "").startsWith(v)));

// Wrap every per-item condition mentioning `v` in an AND with `rule`.
function gateEvery(node, v, rule, count = { n: 0 }) {
  if (!node || typeof node !== "object") return count;
  if (Array.isArray(node)) { node.forEach((x) => gateEvery(x, v, rule, count)); return count; }
  for (const key of ["condition", "predicate"]) {
    const grp = node[key];
    if (grp && Array.isArray(grp.rules) && touchesVar(grp, v)) {
      node[key] = { id: rid(), operator: "AND", rules: [grp, JSON.parse(JSON.stringify(rule))] };
      count.n++;
    }
  }
  Object.values(node).forEach((x) => gateEvery(x, v, rule, count));
  return count;
}

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const one = (n) => {
    const hits = fields.filter((f) => f.name === n);
    if (hits.length !== 1) throw new Error(`field "${n}": ${hits.length} matches - refusing`);
    return hits[0];
  };
  const cash = one("Cash");
  const amountIds = fields.filter((f) => f.name === "Amount").map((f) => f.id);
  const income = one("Income");
  const toAccount = fields.find((f) => f.name === "To Account");
  if (!amountIds.length) throw new Error("no Amount field - refusing");

  const mods = await Module.find({ gridId: gid }).lean();
  const occs = await Occurrence.find({ gridId: gid }).lean();

  // ---- 1: Net Worth's Cash term --------------------------------------------
  const cashMods = mods.filter((m) => (m.fieldBindings || []).some((b) => b.fieldId === cash.id));
  if (cashMods.length !== 1) throw new Error(`${cashMods.length} modules bind "Cash" - refusing to guess`);
  const cashMod = cashMods[0];

  const nw = await Operation.findOne({ gridId: gid, name: "Net Worth" }).lean();
  if (!nw) throw new Error('no "Net Worth" operation - refusing');
  const nwPipe = JSON.parse(JSON.stringify(nw.pipeline));
  let fixed = 0;
  const fixCash = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(fixCash);
    if (Array.isArray(node.rules)) {
      // The pair is (templateId IS X) AND (fields.<Cash>.value IS_NOT_EMPTY)
      // inside one group. Rewrite X only where the group also names Cash.
      const namesCash = node.rules.some((r) => String(r?.left || "").includes(cash.id));
      if (namesCash) {
        for (const r of node.rules) {
          if (String(r?.left || "") === "$item.templateId" && r.right !== cashMod.id) {
            r.right = cashMod.id; fixed++;
          }
        }
      }
    }
    Object.values(node).forEach(fixCash);
  };
  fixCash(nwPipe);
  const cashOcc = occs.find((o) => o.moduleId === cashMod.id);
  if (fixed) {
    log(`  Net Worth: Cash term repointed to "${cashOcc?.label || cashMod.label}" (module ${cashMod.id}, Cash = ${JSON.stringify(cashOcc?.fields?.[cash.id]?.value)})`);
    if (apply) await Operation.updateOne({ id: nw.id, gridId: gid }, { $set: { pipeline: nwPipe } });
  } else log("  Net Worth: Cash term already correct - left alone");

  // ---- 2: a purchase is money OUT ------------------------------------------
  const ph = await Operation.findOne({ gridId: gid, name: "Purchase History" }).lean();
  if (!ph) throw new Error('no "Purchase History" - refusing');
  const phPipe = JSON.parse(JSON.stringify(ph.pipeline));
  const already = amountIds.some((a) => JSON.stringify(phPipe).includes(`"$inst.fields.${a}.flow"`));
  if (already) log("  Purchase History: already gated on flow - left alone");
  else {
    const n = gateEvery(phPipe, "$inst.", {
      id: rid(), left: `$inst.fields.${amountIds[0]}.flow`, comparator: "IS", right: "out",
    });
    if (!n.n) throw new Error('"Purchase History": no per-item gate found - refusing');
    log(`  Purchase History: ${n.n} gate(s) -> Amount.flow IS out (was counting replace + in as purchases)`);
    if (apply) await Operation.updateOne({ id: ph.id, gridId: gid }, { $set: { pipeline: phPipe } });
  }

  // ---- 3: money arriving in an account is income ---------------------------
  const earned = await Operation.findOne({ gridId: gid, name: "Earned" }).lean();
  if (!earned) throw new Error('no "Earned" - refusing');
  const eaPipe = JSON.parse(JSON.stringify(earned.pipeline));
  if (amountIds.some((a) => JSON.stringify(eaPipe).includes(`fields.${a}.flow`))) {
    log("  Earned: already counts an Amount inflow - left alone");
  } else {
    // Clone the Income loop and retarget it at Amount-in. Cloning keeps every
    // other gate the exemplar carries (completed, in period, under the
    // Schedule, not a feed copy, the category filter) rather than restating
    // them, which is how two loops drift.
    const loops = [];
    (function find(node) {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(find);
      const c = node.config || node;
      if ((c?.type === "loop" || node.type === "loop") && JSON.stringify(node).includes(`fields.${income.id}.flow`)) {
        loops.push(node); return;
      }
      Object.values(node).forEach(find);
    })(eaPipe);
    if (loops.length !== 1) throw new Error(`"Earned": ${loops.length} Income loops - refusing to guess`);

    const reid = (n) => {
      if (!n || typeof n !== "object") return n;
      if (Array.isArray(n)) return n.map(reid);
      const o = { ...n };
      if (typeof o.id === "string") o.id = rid();
      for (const k of Object.keys(o)) if (o[k] && typeof o[k] === "object") o[k] = reid(o[k]);
      return o;
    };
    let s = JSON.stringify(reid(JSON.parse(JSON.stringify(loops[0]))));
    s = s.split(income.id).join(amountIds[0]);
    const clone = JSON.parse(s);
    // A TRANSFER IN IS NOT INCOME. `0299` made an arrival identifiable by
    // `To Account`; rows carrying one are excluded, or moving $100 between
    // your own accounts would read as $100 earned.
    if (toAccount) {
      gateEvery(clone, "$item.", { id: rid(), left: `$item.fields.${toAccount.id}.value`, comparator: "IS_EMPTY", right: "" });
    }
    const holder = (function findHolder(node) {
      if (!node || typeof node !== "object") return null;
      if (Array.isArray(node)) {
        if (node.includes(loops[0])) return node;
        for (const x of node) { const r = findHolder(x); if (r) return r; }
        return null;
      }
      for (const v of Object.values(node)) { const r = findHolder(v); if (r) return r; }
      return null;
    })(eaPipe);
    if (!holder) throw new Error('"Earned": cannot locate the Income loop\'s holder - refusing');
    holder.splice(holder.indexOf(loops[0]) + 1, 0, clone);
    log(`  Earned: + a loop summing Amount flow=in${toAccount ? ", excluding transfer arrivals (To Account set)" : " (no To Account field — transfers NOT excluded)"}`);
    if (apply) await Operation.updateOne({ id: earned.id, gridId: gid }, { $set: { pipeline: eaPipe } });
  }

  if (!apply) log("  DRY RUN - pass --apply to write.");
}
