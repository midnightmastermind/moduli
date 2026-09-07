// The four account rows come off the Financial group.
//
// User, 2026-09-06: *"what im saying is that i dont want these empty tiles for
// each account now. why would you keep those in, i dont want these empty rows."*
//
// They were right and my reason was half an answer. Eleven transactions name
// those four rows, so they have to stay ADDRESSABLE — that is not the same as
// staying ON SCREEN, and I conflated the two. 0311 restored them as tiles when
// all they ever needed to be is identities.
//
// `occurrence.hidden` is exactly that line, and it is drawn in one place:
//
//   selectors.isOccurrenceVisible   `if (occurrence.hidden) return false`
//
// Nothing else reads it. Not the options resolver, not the executor, not the
// value renderer — checked, and it is what makes this safe rather than clever:
// the Account dropdown keeps listing all four, the eleven stored picks keep
// resolving to their labels, and the four balance ops keep gating on their ids.
// Only the render drops them.
//
// ── AND THE ROWS WERE NOT EMPTY, WHICH IS THE HALF I HAD WRONG ─────────────
//
// I recorded 0310 as having "removed the two duplicate homes — Spent off
// Checking, Earned off Savings". It removed the BINDINGS, so the numbers
// stopped rendering. It did not remove the WRITES: `Spent` still ends
//
//   INIT_VAR $acctItem = $allItemsById.<Checking Account>
//   UPDATE   $acctItem.fields.<Spent>.value = $acc
//
// and `Earned` the same into Savings. So the ops kept writing a number into a
// row that displays nothing — the `0047` class inverted, a value with no home
// rather than a home with no value. Hiding the row would have made that
// permanent and invisible. Both writes go, and the values they left go with
// them.
//
// ── THE SELECTOR IS THE GATE, NOT THE LABEL ───────────────────────────────
//
// 0311 keyed on a label and 0312 had to repair it. An account here is *a row
// some operation names on the right of an `Account`-field gate* — the thing a
// transaction actually points at. Rename "Cash" tomorrow and this still finds
// it; delete the gate and it correctly finds nothing.
//
// Idempotent: converges once the four are hidden and neither op names them.
import Field from "../models/Field.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0313-an-account-is-an-identity-not-a-tile";
export const description =
  "The four account rows are identities, not tiles: hidden from render, still addressable.";
export const touches = ["fields", "modules", "occurrences", "operations"];

const walk = (n, fn) => {
  if (Array.isArray(n)) return n.forEach((x) => walk(x, fn));
  if (n && typeof n === "object") { fn(n); Object.values(n).forEach((v) => walk(v, fn)); }
};

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const mods   = await Module.find({ gridId: gid }).lean();
  const occs   = await Occurrence.find({ gridId: gid }).lean();
  const ops    = await Operation.find({ gridId: gid }).lean();

  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));
  const occById = Object.fromEntries(occs.map((o) => [o.id, o]));
  const fieldName = Object.fromEntries(fields.map((f) => [f.id, f.name]));
  const labelOf = (o) => o && (o.label || modById[o.moduleId]?.label || "(unlabeled)");

  // ── 1. WHICH FIELD SAYS "which account" ─────────────────────────────────
  const acctFields = fields.filter((f) => f.name === "Account" && f.type === "occurrence");
  if (acctFields.length !== 1)
    throw new Error(`expected exactly 1 occurrence field named "Account", found ${acctFields.length} - refusing`);
  const acctFieldId = acctFields[0].id;

  // ── 2. WHICH ROWS ARE ACCOUNTS — by the gate, never by the label ─────────
  const gateLeft = `$item.fields.${acctFieldId}.value`;
  const accountIds = new Set();
  for (const op of ops) {
    walk(op.pipeline, (n) => {
      if (n.left === gateLeft && n.comparator === "IS" && typeof n.right === "string" && occById[n.right])
        accountIds.add(n.right);
    });
  }
  if (!accountIds.size)
    throw new Error(`no operation gates on the "Account" field - refusing to guess which rows are accounts`);

  log(`  accounts named by an Account gate: ${[...accountIds].map((id) => labelOf(occById[id])).join(" · ")}`);

  // ── 3. STRIP THE STALE SECOND WRITE ─────────────────────────────────────
  // An INIT_VAR binding a var to an account row, plus every UPDATE writing
  // through that var. Both go; the account holds no numbers.
  const opWrites = [];
  for (const op of ops) {
    let changed = false;
    const strip = (steps) => {
      if (!Array.isArray(steps)) return steps;
      // Which vars in THIS list are bound to an account row?
      const acctVars = new Set();
      for (const s of steps) {
        const c = s?.config || {};
        if (c.type !== "INIT_VAR" || typeof c.expr !== "string") continue;
        const m = /^\$allItemsById\.([A-Za-z0-9_-]+)$/.exec(c.expr);
        if (m && accountIds.has(m[1]) && c.name) acctVars.add(c.name);
      }
      const kept = [];
      for (const s of steps) {
        const c = s?.config || {};
        const isBind = c.type === "INIT_VAR" && acctVars.has(c.name);
        const isWrite = c.type === "UPDATE" && typeof c.path === "string"
          && [...acctVars].some((v) => c.path.startsWith(`${v}.`));
        if (isBind || isWrite) {
          changed = true;
          if (isWrite) {
            const fid = /\.fields\.([A-Za-z0-9_-]+)\.value/.exec(c.path)?.[1];
            opWrites.push(`${op.name}: ${c.path} (${fieldName[fid] || fid})`);
          }
          continue;
        }
        for (const k of ["then", "else", "body", "steps"]) if (Array.isArray(s[k])) s[k] = strip(s[k]);
        kept.push(s);
      }
      return kept;
    };
    if (op.pipeline?.steps) op.pipeline.steps = strip(op.pipeline.steps);
    if (changed) {
      log(`  ${op.name}: dropping its write into an account row`);
      if (apply) await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { pipeline: op.pipeline } });
    }
  }
  if (!opWrites.length) log(`  no operation writes into an account row (already converged)`);
  else opWrites.forEach((w) => log(`      ${w}`));

  // ── 4. HIDE THE ROWS, AND CLEAR WHAT THE STALE WRITES LEFT ──────────────
  let hid = 0, cleared = 0;
  for (const id of accountIds) {
    const occ = occById[id];
    const listers = occs.filter((o) => (o.occurrences || []).includes(id));

    // The dropdown finds options by ANCESTRY. A row nobody lists has no
    // ancestors, so hiding it would ALSO drop it out of the picker - which is
    // the one thing this migration must not do.
    if (!listers.length)
      throw new Error(`"${labelOf(occ)}" is listed by nobody - hiding it would drop it from the Account dropdown; refusing`);

    // Values the stale writes left behind, on fields the row no longer binds.
    const bound = new Set((modById[occ.moduleId]?.fieldBindings || []).map((b) => b.fieldId));
    const stale = Object.keys(occ.fields || {}).filter((fid) => !bound.has(fid));

    log(`  ${labelOf(occ)}: hidden=${!!occ.hidden}->true · listed by ${listers.map(labelOf).join(", ")}`
      + (stale.length ? ` · clearing ${stale.map((f) => fieldName[f] || f).join(", ")}` : ""));

    if (apply) {
      const $set = { hidden: true };
      const $unset = Object.fromEntries(stale.map((fid) => [`fields.${fid}`, ""]));
      await Occurrence.updateOne({ id, gridId: gid },
        stale.length ? { $set, $unset } : { $set });
    }
    if (!occ.hidden) hid++;
    cleared += stale.length;
  }

  log(`  ${hid} row(s) ${apply ? "hidden" : "would be hidden"}, ${cleared} stale value(s) cleared.`);
  if (!apply) log("  DRY RUN - pass --apply to write.");
}
