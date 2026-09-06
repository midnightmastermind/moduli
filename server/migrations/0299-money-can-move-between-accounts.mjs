// A transfer is money LEAVING one account and ARRIVING in another, and the grid
// could only ever express half of that.
//
// User, 2026-09-05: *"we need a transfer routine occurance where i can transfer
// money between accounts"* (asked twice).
//
// ── HALF OF IT ALREADY WORKS, WHICH IS WHY THIS IS ONE LOOP AND NOT AN OP ──
//
// Every balance op's spending loop sums `Amount` for rows tagged to its
// account and then negates the total (`$spentAcc *= -1`). It gates on
// `Amount.flow IS_NOT replace` and NOT on the flow being "out" - so ANY
// Amount on a row tagged to an account is money leaving it. A transfer's
// OUT-LEG therefore needs no new machinery at all: tag the row to the account
// the money leaves and the existing loop already subtracts it.
//
// What has no expression is the ARRIVAL. So this adds one field - `To Account`
// - and one loop per balance op: sum `Amount` where `To Account IS <this
// tile>` and add it. One row, two balances, opposite signs.
//
// ── AND NET WORTH IS CORRECT WITHOUT BEING TOLD ────────────────────────────
//
// `0288` made Net Worth the sum of Checking + Savings + Cash. A transfer
// between two of them is -N and +N, so it nets to zero on its own. A transfer
// OUT to Mom's Account (which Net Worth deliberately excludes) correctly
// lowers it. Neither case is special-cased anywhere.
//
// ── THE IN-LEG IS STRICT WHERE THE OUT-LEG IS NOT ──────────────────────────
//
// `0298` gave Checking an "or untagged" arm, because most money on this grid
// carries no account and the user chose Checking as the default. The in-leg
// gets NO such arm: a transfer with no destination is not a transfer, and
// admitting the untagged would make every ordinary spend on the grid ALSO
// count as money arriving in Checking - the balance would roughly double while
// looking like a plausible number.
//
// ── THE LOOP IS CLONED, NOT AUTHORED ───────────────────────────────────────
//
// Writing a fresh loop means restating eight gates (completed, in-period,
// scoped to the Schedule, not a feed copy, after the logged-balance base, the
// category filter...) that the spending loop already carries and that a later
// pass would have to remember to change in two places. It is cloned from that
// loop and two things are changed: the account rule, and which var it adds to.
import Field from "../models/Field.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0299-money-can-move-between-accounts";
export const description =
  "A Transfer routine, a To Account field, and the in-leg loop every balance op was missing.";
export const touches = ["fields", "modules", "occurrences", "operations"];

const rid = () => "a" + Math.random().toString(36).slice(2, 12);
const BALANCE_OPS = ["Checking Balance", "Savings Balance", "Cash Balance", "Mom's Account Balance"];

// Walks for the OUTFLOW loop: the one gated `Amount.flow IS_NOT replace`.
// Identified by shape, never by position - a loop order is not a contract.
//
// THE FOUR BALANCE OPS DO NOT AGREE ON SIGN, and that is measured rather than
// assumed. Checking and Savings sum every non-replace Amount into `$spentAcc`
// and multiply it by -1; Cash and Mom's ADD it straight into `$acc`. And
// `ADD_TO_VAR` reads the RAW value - the executor does not apply `flow` - so
// on those two, spending money RAISES the balance. Both shapes are handled,
// and the sign is corrected where it is wrong (reported, not silent).
function findOutflowLoop(node, amountIds, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((x) => findOutflowLoop(x, amountIds, out)); return out; }
  const type = node.config?.type || node.type;
  if (type === "loop") {
    const s = JSON.stringify(node);
    const isOutflow = amountIds.some((a) =>
      s.includes(`"left":"$item.fields.${a}.flow","comparator":"IS_NOT","right":"replace"`));
    if (isOutflow) out.push(node);
  }
  Object.values(node).forEach((v) => findOutflowLoop(v, amountIds, out));
  return out;
}

// Every var the pipeline later multiplies by a negative - i.e. the vars whose
// accumulation is a SUBTRACTION in disguise.
function negatedVars(node, out = new Set()) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((x) => negatedVars(x, out)); return out; }
  const c = node.config || node;
  if (c?.type === "MULTIPLY_VAR" && Number(c.by ?? c.expr) < 0 && c.name) out.add(c.name);
  Object.values(node).forEach((v) => negatedVars(v, out));
  return out;
}

// The accumulation node inside a loop body.
function accumulators(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) { node.forEach((x) => accumulators(x, out)); return out; }
  const t = node.config?.type || node.type;
  // Push and STOP. Recursing on would descend into `node.config`, which is an
  // object carrying the same `type` - so every step counted twice and the
  // "exactly one accumulator" guard refused a perfectly ordinary loop.
  if (t === "ADD_TO_VAR" || t === "SUBTRACT_FROM_VAR") { out.push(node); return out; }
  Object.values(node).forEach((v) => accumulators(v, out));
  return out;
}

// The parent array a loop sits in, so the clone can be inserted right after it.
function findHolder(node, target, out = { arr: null, idx: -1 }) {
  if (!node || typeof node !== "object" || out.arr) return out;
  if (Array.isArray(node)) {
    const i = node.indexOf(target);
    if (i !== -1) { out.arr = node; out.idx = i; return out; }
    node.forEach((x) => findHolder(x, target, out));
    return out;
  }
  Object.values(node).forEach((v) => findHolder(v, target, out));
  return out;
}

const reid = (n) => {
  if (!n || typeof n !== "object") return n;
  if (Array.isArray(n)) return n.map(reid);
  const o = { ...n };
  if (typeof o.id === "string") o.id = rid();
  for (const k of Object.keys(o)) if (o[k] && typeof o[k] === "object") o[k] = reid(o[k]);
  return o;
};

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const one = (name) => {
    const hits = fields.filter((f) => f.name === name);
    if (hits.length !== 1) throw new Error(`field "${name}": ${hits.length} matches - refusing`);
    return hits[0];
  };
  const account = one("Account");
  const amountIds = fields.filter((f) => f.name === "Amount").map((f) => f.id);
  if (!amountIds.length) throw new Error("no Amount field - refusing");

  // ---- 1: the destination field ------------------------------------------
  // Cloned from `Account` so it offers the same account tiles and mints new
  // ones the same way. Authoring a second predicate by hand is how the two
  // dropdowns quietly stop listing the same accounts.
  let toAccount = fields.find((f) => f.name === "To Account");
  if (toAccount) log("  To Account: field already exists - left alone");
  else {
    toAccount = {
      ...account, _id: undefined, id: "f" + Math.random().toString(36).slice(2, 12),
      name: "To Account",
    };
    log(`  To Account: minting from "Account"'s own config (${account.type}, same account pool)`);
    if (apply) await Field.create(toAccount);
  }

  // ---- 2: the Transfer routine -------------------------------------------
  const mods = await Module.find({ gridId: gid }).lean();
  const occs = await Occurrence.find({ gridId: gid }).lean();
  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));

  const existing = mods.find((m) => m.label === "Transfer" && (m.fieldBindings || []).length);
  if (existing) log("  Transfer: routine already exists - left alone");
  else {
    // `Track` is the money routine with no purchase/income specifics - the
    // closest existing shape, so the Habit marker and the hidden Date /
    // Category / Completed On bindings come along rather than being
    // re-listed. A routine minted without the Habit marker lands in the
    // TASKS count instead of Completed Habits (2026-08-20).
    const src = mods.find((m) => m.label === "Track" && (m.fieldBindings || []).length);
    if (!src) throw new Error('no "Track" routine to copy the shape of - refusing');
    const srcOcc = occs.find((o) => o.moduleId === src.id);
    if (!srcOcc?.parentId) throw new Error('"Track" has no placed occurrence to home beside - refusing');

    const bindings = [...(src.fieldBindings || [])];
    const at = bindings.findIndex((b) => b.fieldId === account.id);
    if (at === -1) throw new Error('"Track" does not bind Account - refusing');
    // Immediately after Account: binding order IS render order, so "from" then
    // "to" reads the way the sentence does.
    bindings.splice(at + 1, 0, { ...bindings[at], fieldId: toAccount.id });

    const mod = {
      ...src, _id: undefined, id: "m" + Math.random().toString(36).slice(2, 12),
      label: "Transfer", fieldBindings: bindings,
    };
    const occ = {
      ...srcOcc, _id: undefined, id: "o" + Math.random().toString(36).slice(2, 12),
      moduleId: mod.id, label: null, occurrences: [], fields: {},
    };
    const parent = occs.find((o) => o.id === srcOcc.parentId);
    log(`  Transfer: minting beside "Track" under "${parent?.label || modById[parent?.moduleId]?.label}" (${bindings.length} bindings)`);
    if (apply) {
      await Module.create(mod);
      await Occurrence.create(occ);
      // Listed by the parent as well as parented to it - a child that is only
      // parented renders nowhere (the listed-but-not-embedded class).
      await Occurrence.updateOne({ id: parent.id, gridId: gid }, { $addToSet: { occurrences: occ.id } });
    }
  }

  // ---- 3: the in-leg, one loop per balance op ----------------------------
  for (const name of BALANCE_OPS) {
    const op = await Operation.findOne({ gridId: gid, name }).lean();
    if (!op) { log(`  ${name}: no such operation - SKIPPED`); continue; }
    if (JSON.stringify(op.pipeline).includes(toAccount.id)) {
      log(`  ${name}: already has an in-leg - left alone`); continue;
    }
    const pipeline = JSON.parse(JSON.stringify(op.pipeline));
    const flows = findOutflowLoop(pipeline, amountIds);
    if (flows.length !== 1) throw new Error(`"${name}": ${flows.length} outflow loops - refusing to guess`);
    const outflow = flows[0];

    const accs = accumulators(outflow);
    if (accs.length !== 1) throw new Error(`"${name}": outflow loop has ${accs.length} accumulators - refusing`);
    const accCfg = accs[0].config || accs[0];
    const negated = negatedVars(pipeline);

    // (a) CORRECT THE SIGN where money leaving an account currently raises it.
    if (accCfg.type === "ADD_TO_VAR" && !negated.has(accCfg.name)) {
      accCfg.type = "SUBTRACT_FROM_VAR";
      log(`  ${name}: outflow ADDED to ${accCfg.name} and nothing negated it - spending RAISED this balance; now subtracts`);
    }

    // (b) THE IN-LEG: the same loop, keyed on the destination, adding.
    const clone = reid(JSON.parse(JSON.stringify(outflow)));

    // The account gate becomes the DESTINATION gate, STRICT - no untagged arm.
    // Walked rather than string-replaced: `0298` wrapped Checking's rule in an
    // OR, and a blind replace would leave the untagged arm behind and admit
    // every untagged spend on the grid as money ARRIVING in Checking.
    let swapped = 0;
    const retarget = (n) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(retarget);
      if (Array.isArray(n.rules)) {
        n.rules = n.rules.map((r) => {
          const isAcctGroup = Array.isArray(r?.rules) && r.rules.some(
            (x) => String(x?.left || "") === `$item.fields.${account.id}.value`);
          if (isAcctGroup) {
            const keep = r.rules.find((x) => x.comparator === "IS");
            swapped++;
            return { id: rid(), left: `$item.fields.${toAccount.id}.value`, comparator: "IS", right: keep?.right };
          }
          if (String(r?.left || "") === `$item.fields.${account.id}.value`) {
            swapped++;
            return { ...r, id: rid(), left: `$item.fields.${toAccount.id}.value`, comparator: "IS" };
          }
          return r;
        });
      }
      Object.values(n).forEach(retarget);
    };
    retarget(clone);
    if (swapped !== 1) throw new Error(`"${name}": swapped ${swapped} account gates in the clone, expected 1 - refusing`);

    // An arrival ADDS to the running balance, whichever shape the op uses -
    // never into a var something else is about to negate.
    const cloneAccs = accumulators(clone);
    if (cloneAccs.length !== 1) throw new Error(`"${name}": clone has ${cloneAccs.length} accumulators - refusing`);
    const cCfg = cloneAccs[0].config || cloneAccs[0];
    cCfg.type = "ADD_TO_VAR";
    cCfg.name = "$acc";

    const holder = findHolder(pipeline, outflow);
    if (!holder.arr) throw new Error(`"${name}": cannot locate the outflow loop's holder - refusing`);
    holder.arr.splice(holder.idx + 1, 0, clone);

    log(`  ${name}: in-leg added -> To Account IS its own tile, ADD_TO_VAR $acc`);
    if (apply) await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { pipeline } });
  }

  if (!apply) log("  DRY RUN - pass --apply to write.");
}
