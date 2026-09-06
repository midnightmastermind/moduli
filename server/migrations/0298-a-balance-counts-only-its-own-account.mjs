// Account balances counted every transaction, whatever account it belonged to.
//
// User, 2026-09-05: *"it should be logged balance but that should still be
// affected by tagged transactions, thats how checking should be too"*, and on
// the untagged case: **untagged money counts toward Checking.**
//
// The mechanism was already here and unused. `Account` is an occurrence field
// bound by 22 money modules - Spend, Earn, Buy, Track, and every bill - whose
// dropdown offers the account TILES under the Trackers page. `makeTrackerOp`
// has carried `accountRefFieldId` + `accountOccurrenceId` for exactly this gate.
// What was missing is that no stored balance op used it: `Checking Balance`
// summed ALL income minus ALL spending, and `Savings Balance` had no op at all
// while every other account had one.
//
// ── THE ACCOUNT A BALANCE OP IS FOR *IS* ITS OWN GOAL TILE ─────────────────
//
// So the gate is derived, not configured: each balance op already names its
// tile picker-direct (`$allItemsById.<id>`), the Account field points AT those
// same tiles, and the rule is `$item.fields.<Account>.value IS <that tile>`.
// Nothing here is told which account is which.
//
// ── CHECKING TAKES THE UNTAGGED, AND THAT ARM IS THE LOAD-BEARING ONE ──────
//
// Only THREE money rows on the grid carry an Account today (all Savings).
// Gating every account strictly would drop every other row out of every
// balance - money the user has logged simply ceasing to count. So Checking's
// gate is `(Account IS Checking) OR (Account IS_EMPTY)` and the others are
// strict. Tagging a row moves it; leaving it alone keeps today's meaning.
//
// ── IT WRAPS THE CONDITION RATHER THAN APPENDING ───────────────────────────
//
// Same reason as `0290`: these per-item conditions carry an `operator` and some
// are OR groups, so pushing a rule in would WIDEN the match - the balance would
// count MORE while looking like a plausible number. Wrapping in an explicit AND
// is correct whatever the original operator was.
import Field from "../models/Field.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0298-a-balance-counts-only-its-own-account";
export const description =
  "Account balances gate on the Account tag; Savings gets the op every other account already had.";
export const touches = ["fields", "modules", "occurrences", "operations"];

const rid = () => "a" + Math.random().toString(36).slice(2, 12);

// Named, then VERIFIED structurally - each must resolve to exactly one op and
// one goal tile or the migration refuses.
const BALANCE_OPS = ["Checking Balance", "Cash Balance", "Mom's Account Balance"];
const TAKES_UNTAGGED = "Checking Balance";

const touchesItem = (grp) => Array.isArray(grp?.rules) && grp.rules.some(
  (r) => (Array.isArray(r?.rules) ? touchesItem(r) : String(r?.left || "").startsWith("$item.")));

const gateEveryItem = (node, rule, count = { n: 0 }) => {
  if (!node || typeof node !== "object") return count;
  if (Array.isArray(node)) { node.forEach((x) => gateEveryItem(x, rule, count)); return count; }
  for (const key of ["condition", "predicate"]) {
    const grp = node[key];
    if (grp && Array.isArray(grp.rules) && touchesItem(grp)) {
      node[key] = { operator: "AND", rules: [grp, JSON.parse(JSON.stringify(rule))] };
      count.n++;
    }
  }
  Object.values(node).forEach((v) => gateEveryItem(v, rule, count));
  return count;
};

// Counts REAL rules on the Account field, split by whether they already admit
// the untagged. Walks the tree - a rule can sit at any depth inside nested
// condition groups.
const countAccountRules = (node, acctId, acc = { strict: 0, untagged: 0 }) => {
  if (!node || typeof node !== "object") return acc;
  if (Array.isArray(node)) { node.forEach((x) => countAccountRules(x, acctId, acc)); return acc; }
  if (String(node.left || "") === `$item.fields.${acctId}.value`) {
    if (node.comparator === "IS_EMPTY") acc.untagged++;
    else acc.strict++;
  }
  Object.values(node).forEach((v) => countAccountRules(v, acctId, acc));
  return acc;
};

// Replaces each strict `Account IS <tile>` with `(IS <tile> OR IS_EMPTY)`.
const relaxAccountRules = (node, acctId, tileId, count = { n: 0 }) => {
  if (!node || typeof node !== "object") return count;
  if (Array.isArray(node)) { node.forEach((x) => relaxAccountRules(x, acctId, tileId, count)); return count; }
  // DEPTH FIRST, then replace at this level - recursing AFTER the map walks
  // straight back into the OR group just built (which still holds the `IS`
  // rule) and rebuilds it forever. That is a stack overflow, not a bad rule.
  Object.values(node).forEach((v) => relaxAccountRules(v, acctId, tileId, count));
  if (Array.isArray(node.rules)) {
    node.rules = node.rules.map((r) => {
      if (String(r?.left || "") === `$item.fields.${acctId}.value` && r.comparator === "IS") {
        count.n++;
        return { id: rid(), operator: "OR", rules: [
          { ...r },
          { id: rid(), left: `$item.fields.${acctId}.value`, comparator: "IS_EMPTY", right: "" },
        ] };
      }
      return r;
    });
  }
  return count;
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
  const savingsBalance = one("Savings Balance");

  const occs = await Occurrence.find({ gridId: gid }).lean();
  const mods = await Module.find({ gridId: gid }).lean();
  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));
  const labelOf = (o) => o.label || modById[o.moduleId]?.label;

  const goalOf = (op) => {
    const refs = [...new Set([...JSON.stringify(op.pipeline || {}).matchAll(/\$allItemsById\.([A-Za-z0-9_-]+)/g)].map((m) => m[1]))];
    const tiles = refs.filter((r) => occs.some((o) => o.id === r));
    if (tiles.length !== 1) throw new Error(`"${op.name}" names ${tiles.length} goal tiles - refusing`);
    return tiles[0];
  };

  const gateFor = (tileId, untagged) => untagged
    ? { id: rid(), operator: "OR", rules: [
        { id: rid(), left: `$item.fields.${account.id}.value`, comparator: "IS", right: tileId },
        { id: rid(), left: `$item.fields.${account.id}.value`, comparator: "IS_EMPTY", right: "" },
      ] }
    : { id: rid(), left: `$item.fields.${account.id}.value`, comparator: "IS", right: tileId };

  // Snapshot BEFORE step 1 relaxes it. Step 2 mirrors Checking, and on an
  // --apply run step 1 has already written the untagged arm - a fresh read
  // there would copy "or untagged" onto Savings, which is exactly what the
  // refusal below guards against. Read once, up front.
  const checkingBefore = await Operation.findOne({ gridId: gid, name: TAKES_UNTAGGED }).lean();

  // ---- 1: gate the balance ops that already exist -------------------------
  for (const name of BALANCE_OPS) {
    const op = await Operation.findOne({ gridId: gid, name }).lean();
    if (!op) { log(`  ${name}: no such operation - SKIPPED`); continue; }
    const tile = goalOf(op);
    const untagged = name === TAKES_UNTAGGED;
    const pipeline = JSON.parse(JSON.stringify(op.pipeline));
    const had = countAccountRules(pipeline, account.id);

    // ALREADY GATED, and correctly so - every account but Checking is strict.
    // (My first version tested `JSON.stringify(pipeline).includes(account.id)`
    // and reported all three "already gated", silently skipping the one op the
    // user actually asked to change. A substring is not a rule.)
    if (had.strict && !untagged) { log(`  ${name}: ${had.strict} strict Account rule(s) - already correct`); continue; }
    if (had.untagged) { log(`  ${name}: already takes untagged - left alone`); continue; }

    let n;
    if (had.strict) {
      // Gated, but strictly - and this is the account that takes the untagged.
      // Relax each rule in place rather than adding a second gate: an AND of
      // "IS Checking" and "IS Checking OR IS_EMPTY" is still strict.
      n = relaxAccountRules(pipeline, account.id, tile);
      log(`  ${name}: ${n.n} strict rule(s) relaxed -> Account IS ${labelOf(occs.find((o) => o.id === tile))} OR untagged`);
    } else {
      n = gateEveryItem(pipeline, gateFor(tile, untagged));
      log(`  ${name}: ${n.n} loop gate(s) -> Account IS ${labelOf(occs.find((o) => o.id === tile))}${untagged ? " OR untagged" : ""}`);
    }
    if (!n.n) throw new Error(`"${name}": nothing to gate or relax - refusing`);
    if (apply) await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { pipeline } });
  }

  // ---- 2: the Savings op every other account already had ------------------
  const existing = await Operation.findOne({ gridId: gid, name: "Savings Balance" }).lean();
  if (existing) { log("  Savings Balance: operation already exists - left alone"); }
  else {
    const src = checkingBefore;
    if (!src) throw new Error("no Checking Balance to mirror - refusing");
    const srcTile = goalOf(src);
    const srcField = fields.find((f) => f.name === "Checking Balance");
    // The Savings tile is the one the Account tag already points at, read off
    // the data rather than looked up by label.
    const tagged = occs.filter((o) => o.fields?.[account.id]?.value).map((o) => o.fields[account.id].value)
      .map((v) => (Array.isArray(v) ? v[0] : v));
    const savingsTile = occs.find((o) => (o.fieldBindings || modById[o.moduleId]?.fieldBindings || [])
      .some?.((b) => b.fieldId === savingsBalance.id))
      || occs.find((o) => (modById[o.moduleId]?.fieldBindings || []).some((b) => b.fieldId === savingsBalance.id));
    if (!savingsTile) throw new Error("no tile binds Savings Balance - refusing");
    log(`  Savings Balance: mirroring "Checking Balance" onto "${labelOf(savingsTile)}"${tagged.includes(savingsTile.id) ? " (rows already tag it)" : ""}`);

    let s = JSON.stringify(src.pipeline);
    s = s.split(srcTile).join(savingsTile.id);
    s = s.split(srcField.id).join(savingsBalance.id);
    const pipeline = JSON.parse(s);
    // A balance op's goal tile IS its account tile (measured: Checking's goal
    // ref and its Account rule's right are the same occurrence), so the id swap
    // above already retargeted the copied gates at Savings. Adding more would
    // AND the same condition with itself.
    const carried = countAccountRules(pipeline, account.id);
    const n = carried.strict
      ? { n: carried.strict }
      : gateEveryItem(pipeline, gateFor(savingsTile.id, false));
    log(`     ${n.n} ${carried.strict ? "gate(s) carried by the swap" : "loop gate(s) added"} -> Account IS ${labelOf(savingsTile)}`);
    // Strict, because Checking is the account that takes the untagged - and
    // the copy must not inherit an untagged arm if Checking is relaxed first.
    if (carried.untagged) throw new Error("mirrored pipeline carries an untagged arm - refusing");
    if (apply) await Operation.create({
      ...src, _id: undefined, id: "op" + Math.random().toString(36).slice(2, 12),
      name: "Savings Balance",
      description: "Checking Balance, for the Savings account: a logged balance plus the transactions tagged to it.",
      pipeline,
    });
  }

  if (!apply) log("  DRY RUN - pass --apply to write.");
}
