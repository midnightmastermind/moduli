// Four balances, four tiles, one number each.
//
// User, 2026-09-06: *"put all the accounts (cash, moms account, checking and
// savings on one tracker tile"* -> *"just all the account fields on one tile"*
// -> *"1 occurance, those fields and a tracker date."*
//
// ── WHAT THE ACCOUNT ROWS ARE, AND WHY THEY SURVIVE ────────────────────────
//
// I went looking for four tiles to delete and found they are not only tiles.
// Measured on the live grid: ELEVEN stored transactions on Track / Earn /
// Pay Bill / Reconcile carry one of these occurrence ids in their `Account`
// field, and the Account dropdown resolves its options by walking ancestors to
// the Trackers page. So each row is the account's IDENTITY - the thing a
// transaction points at - and the tile is only what it happens to display.
//
// Deleting or re-homing them would break every stored pick. So this moves the
// DISPLAY and leaves the identity exactly where it is: the four balance fields
// bind to one tile, the four ops write their numbers there, and the account
// rows keep their id, their parent and their place.
//
//   Checking Account  ->  relabelled "Accounts", binds all four balances
//   Savings / Mom's / Cash  ->  identity rows, balance display removed
//
// It carries a Tracker Date, not the "Total" scope every account tile had. That
// is a real switch and not a relabel: `meta.cumulative` is what routes a tile
// to the label op's TOTAL loop, so it has to go or the daily loop never claims
// the tile and the date stays blank. The stale "Total" value goes with it -
// left behind it would be a scope the tile no longer states.
//
// ── AND TWO DUPLICATE HOMES GO WITH IT ─────────────────────────────────────
//
// `Spent` was displayed on BOTH the Spent tile and Checking Account; `Earned`
// on both Income and Savings Account. That is the 0305 class ("one home per
// number") - 0305 unbound four tiles and missed these two, because they were
// hiding behind an account label rather than a duplicate one. A number written
// once cannot appear in two places; one of them was always going to be stale.
//
// The op targets move with the display. A balance op binds its tile
// picker-direct (`$allItemsById.<occId>`), so repointing is what makes the
// number arrive on the tile that shows it - without it the tile would bind
// four fields and three would stay empty forever.
//
// Idempotent: converges once the tile carries the four bindings and the ops
// name it.
import Field from "../models/Field.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0310-every-account-on-one-tile";
export const description =
  "Every account balance displays on one tile; the account rows stay as identities.";
export const touches = ["fields", "modules", "occurrences", "operations"];

// tile label -> [the balance field it shows, the op that writes it]
const ACCOUNTS = [
  { tile: "Checking Account", field: "Checking Balance",  op: "Checking Balance" },
  { tile: "Savings Account",  field: "Savings Balance",   op: "Savings Balance" },
  { tile: "Mom's Account",    field: "Mom's Account",     op: "Mom's Account Balance" },
  { tile: "Cash",             field: "Cash",              op: "Cash Balance" },
];
// A number displayed twice. The tile named second keeps it.
const DUPLICATE_HOMES = [
  { field: "Spent",  keep: "Spent",  drop: "Checking Account" },
  { field: "Earned", keep: "Income", drop: "Savings Account" },
];
const HOST = "Checking Account";   // the row that becomes the shared tile
const HOST_LABEL = "Accounts";

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const fieldByName = (name) => {
    const hits = fields.filter((f) => f.name === name);
    if (hits.length !== 1) throw new Error(`field "${name}": ${hits.length} matches - refusing`);
    return hits[0];
  };

  const occs = await Occurrence.find({ gridId: gid }).lean();
  const mods = await Module.find({ gridId: gid }).lean();
  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));
  const labelOf = (o) => o.label || modById[o.moduleId]?.label;

  // An ACCOUNT tile is cumulative (a running balance); the tiles that keep the
  // duplicated numbers (Spent, Income) are DAILY. One lookup demanding
  // `cumulative` would refuse the keepers, so the two are asked for separately
  // rather than dropping the guard that makes the account lookup unambiguous.
  const tileByLabel = (label, requireCumulative = false) => {
    const hits = occs.filter(
      (o) => labelOf(o) === label && (!requireCumulative || o.meta?.cumulative)
    );
    if (hits.length !== 1) throw new Error(`tile "${label}": ${hits.length} matches - refusing`);
    return hits[0];
  };
  const accountTileByLabel = (label) => tileByLabel(label, true);

  const host = accountTileByLabel(HOST);
  const hostMod = modById[host.moduleId];

  // A module placed more than once cannot be relabelled without renaming every
  // other placement of it.
  const placements = occs.filter((o) => o.moduleId === hostMod.id).length;
  if (placements !== 1) throw new Error(`"${HOST}" module is placed ${placements}x - refusing to relabel`);

  let bindings = (hostMod.fieldBindings || []).map((b) => ({ ...b }));
  const hostFields = { ...(host.fields || {}) };
  const opPatches = [];
  const rowPatches = [];
  let moved = 0;

  for (const acct of ACCOUNTS) {
    const f = fieldByName(acct.field);
    const tile = accountTileByLabel(acct.tile);

    // 1. the shared tile displays it
    if (!bindings.some((b) => b.fieldId === f.id)) {
      bindings.push({ fieldId: f.id, role: "display", hidden: false });
      moved += 1;
    }

    // 2. its op writes there
    const op = await Operation.findOne({ gridId: gid, name: acct.op }).lean();
    if (!op) throw new Error(`operation "${acct.op}" not found - refusing`);
    const before = JSON.stringify(op.pipeline || {});
    const after = before.split(`$allItemsById.${tile.id}`).join(`$allItemsById.${host.id}`);
    if (after !== before) opPatches.push({ opId: op.id, name: acct.op, pipeline: JSON.parse(after) });

    if (tile.id === host.id) continue;   // the host keeps its own row

    // 3. carry the number across, so the tile is right before the op next runs
    if (tile.fields?.[f.id] !== undefined && hostFields[f.id] === undefined) {
      hostFields[f.id] = tile.fields[f.id];
    }
    // 4. the identity row stops displaying a number it no longer owns
    const rowMod = modById[tile.moduleId];
    const rowBindings = (rowMod?.fieldBindings || []).filter((b) => b.fieldId !== f.id);
    const rowFields = { ...(tile.fields || {}) };
    delete rowFields[f.id];
    if (rowBindings.length !== (rowMod?.fieldBindings || []).length || tile.fields?.[f.id] !== undefined) {
      rowPatches.push({
        label: acct.tile, moduleId: rowMod.id, occId: tile.id,
        bindings: rowBindings, fields: rowFields,
      });
    }
  }

  // ── the two duplicate homes ───────────────────────────────────────────────
  const dupPatches = [];
  for (const dup of DUPLICATE_HOMES) {
    const f = fieldByName(dup.field);
    const keeper = tileByLabel(dup.keep);
    const keeperMod = modById[keeper.moduleId];
    // Refuse unless the keeper really does show it — otherwise this removes the
    // only home and the number renders nowhere.
    if (!(keeperMod?.fieldBindings || []).some((b) => b.fieldId === f.id && !b.hidden)) {
      throw new Error(`"${dup.keep}" does not display "${dup.field}" - refusing to unbind "${dup.drop}"`);
    }
    if (dup.drop === HOST) {
      const n = bindings.length;
      bindings = bindings.filter((b) => b.fieldId !== f.id);
      if (bindings.length !== n) dupPatches.push({ field: dup.field, from: dup.drop, keep: dup.keep });
    } else {
      const row = rowPatches.find((p) => p.label === dup.drop);
      const tile = accountTileByLabel(dup.drop);
      const mod = modById[tile.moduleId];
      const base = row ? row.bindings : (mod?.fieldBindings || []).map((b) => ({ ...b }));
      const next = base.filter((b) => b.fieldId !== f.id);
      if (next.length !== base.length) {
        if (row) row.bindings = next;
        else rowPatches.push({ label: dup.drop, moduleId: mod.id, occId: tile.id, bindings: next, fields: { ...(tile.fields || {}) } });
        dupPatches.push({ field: dup.field, from: dup.drop, keep: dup.keep });
      }
    }
  }

  // ── the tile dates itself instead of saying "Total" ──────────────────────
  const trackerDate = fieldByName("Tracker Date");
  const trackerScope = fieldByName("Tracker Scope");
  let dateSwap = false;
  const scopeIdx = bindings.findIndex((b) => b.fieldId === trackerScope.id);
  if (scopeIdx >= 0) {
    // Rewritten IN PLACE: binding order is render order, so appending would
    // move the date away from where the scope sat.
    bindings[scopeIdx] = { ...bindings[scopeIdx], fieldId: trackerDate.id };
    dateSwap = true;
  } else if (!bindings.some((b) => b.fieldId === trackerDate.id)) {
    bindings.push({ fieldId: trackerDate.id, role: "display", hidden: false });
    dateSwap = true;
  }
  if (hostFields[trackerScope.id] !== undefined) { delete hostFields[trackerScope.id]; dateSwap = true; }
  // `meta.cumulative` routes the tile to the label op's TOTAL loop. A tile that
  // shows a date must fall to the DAILY loop instead, or the date never lands.
  const hostMeta = { ...(host.meta || {}) };
  const wasCumulative = !!hostMeta.cumulative;
  if (wasCumulative) delete hostMeta.cumulative;

  const relabel = hostMod.label !== HOST_LABEL;

  log(`  the shared tile: "${hostMod.label}"${relabel ? ` -> "${HOST_LABEL}"` : ""} (${host.id})`);
  log(`  balance fields bound to it: +${moved}`);
  log(`  ops repointed: ${opPatches.length}`, opPatches.map((p) => p.name).join(", "));
  log(`  identity rows stripped of their balance: ${rowPatches.length}`);
  rowPatches.forEach((p) => log(`    ${p.label}`));
  log(`  duplicate homes removed: ${dupPatches.length}`);
  dupPatches.forEach((p) => log(`    ${p.field}: off ${p.from} (kept on ${p.keep})`));
  log(`  Tracker Scope -> Tracker Date: ${dateSwap ? "yes" : "no"}; drop meta.cumulative: ${wasCumulative ? "yes" : "no"}`);

  if (!moved && !opPatches.length && !rowPatches.length && !dupPatches.length && !relabel && !dateSwap && !wasCumulative) {
    log("  already converged");
    return { ok: true, converged: true };
  }
  if (!apply) {
    log("  DRY RUN - nothing written");
    return { ok: true, dryRun: true, moved, ops: opPatches.length, rows: rowPatches.length };
  }

  await Module.updateOne(
    { id: hostMod.id, gridId: gid },
    { $set: { fieldBindings: bindings, ...(relabel ? { label: HOST_LABEL } : {}) } }
  );
  await Occurrence.updateOne({ id: host.id, gridId: gid }, { $set: { fields: hostFields, meta: hostMeta } });
  for (const p of opPatches) await Operation.updateOne({ id: p.opId, gridId: gid }, { $set: { pipeline: p.pipeline } });
  for (const p of rowPatches) {
    await Module.updateOne({ id: p.moduleId, gridId: gid }, { $set: { fieldBindings: p.bindings } });
    await Occurrence.updateOne({ id: p.occId, gridId: gid }, { $set: { fields: p.fields } });
  }

  log(`  APPLIED - tile "${HOST_LABEL}" shows ${moved} balance(s), ${opPatches.length} op(s) repointed`);
  return { ok: true, moved, ops: opPatches.length, rows: rowPatches.length };
}
