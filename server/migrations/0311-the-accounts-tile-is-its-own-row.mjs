// 0310 built the shared tile out of an ACCOUNT, and that was wrong twice.
//
// User, 2026-09-06: *"1 occurance, those fields and a tracker date."* I read
// "1 occurrence" as "reuse one of the four" and relabelled Checking Account to
// "Accounts". Two things broke, and only one of them was visible.
//
//   1. THE ACCOUNT LOST ITS NAME. Those four rows are not only tiles - eleven
//      stored transactions point at them and the Account dropdown lists them by
//      label. So the account you pick for a purchase started reading "Accounts".
//
//   2. NET WORTH SILENTLY WENT 144.30 -> 4.16, and nothing said so. Its op sums
//      by `$item.templateId` - one rule per account MODULE - so once all four
//      balances lived on the Checking module, only the Checking rule matched.
//      Caught by `moneySemantics`, which exists for exactly this.
//
// The tile is its OWN occurrence now, which is what "1 occurrence" asked for.
// The four accounts go back to being what they were before I touched them:
// rows that a transaction can name.
//
//   Accounts (NEW)     Checking Balance · Savings Balance · Mom's Account ·
//                      Cash · Tracker Date
//   Checking Account   restored - identity row, like the other three
//
// ── NET WORTH IS REPOINTED, NOT REWRITTEN ─────────────────────────────────
//
// Its three rules keep their shape and each names the new module. All three
// then match the SAME row, and the loop visits it once and adds all three
// fields - 4.16 + 123.14 + 17. Mom's Account stays excluded, as it always was:
// it is somebody else's money. Rewriting the loop into three direct reads would
// have been a bigger change to a pipeline whose output is a number the user
// reads daily.
//
// Idempotent: converges once the Accounts row exists and every op names it.
import Field from "../models/Field.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0311-the-accounts-tile-is-its-own-row";
export const description =
  "The shared Accounts tile is its own occurrence; the four accounts keep their names.";
export const touches = ["fields", "modules", "occurrences", "operations"];

const rid = () => "a" + Math.random().toString(36).slice(2, 12);

const BALANCES = [
  { field: "Checking Balance", op: "Checking Balance" },
  { field: "Savings Balance",  op: "Savings Balance" },
  { field: "Mom's Account",    op: "Mom's Account Balance" },
  { field: "Cash",             op: "Cash Balance" },
];
const RESTORE = { label: "Checking Account", from: "Accounts" };

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const fieldByName = (n) => {
    const hits = fields.filter((f) => f.name === n);
    if (hits.length !== 1) throw new Error(`field "${n}": ${hits.length} matches - refusing`);
    return hits[0];
  };
  const occs = await Occurrence.find({ gridId: gid }).lean();
  const mods = await Module.find({ gridId: gid }).lean();
  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));
  const labelOf = (o) => o.label || modById[o.moduleId]?.label;

  const hits = occs.filter((o) => labelOf(o) === RESTORE.from);
  if (hits.length > 1) throw new Error(`"${RESTORE.from}": ${hits.length} rows - refusing`);
  const stale = hits[0] || null;            // the mis-built tile, if 0310 ran
  const holder = occs.find((o) => (o.occurrences || []).includes(stale?.id));
  if (stale && !holder) throw new Error(`"${RESTORE.from}" is listed by nobody - refusing`);

  const already = occs.find((o) => labelOf(o) === "Accounts" && o.meta?.accountsTile);
  if (already) { log("  already converged"); return { ok: true, converged: true }; }
  if (!stale) throw new Error(`no "${RESTORE.from}" row to correct - refusing`);

  const trackerDate = fieldByName("Tracker Date");
  const trackerScope = fieldByName("Tracker Scope");
  const category = fieldByName("Category");
  const staleMod = modById[stale.moduleId];

  // Every balance value currently sits on the mis-built tile; carry them across
  // so the new row is right before its ops next run.
  const newFields = {};
  for (const b of BALANCES) {
    const f = fieldByName(b.field);
    if (stale.fields?.[f.id] !== undefined) newFields[f.id] = stale.fields[f.id];
  }

  const catBinding = (staleMod.fieldBindings || []).find((b) => b.fieldId === category.id);
  const newModId = rid();
  const newOccId = rid();
  const newMod = {
    id: newModId, gridId: gid, userId: staleMod.userId,
    label: "Accounts", role: staleMod.role, kind: staleMod.kind,
    ownStyle: staleMod.ownStyle ?? null,
    fieldBindings: [
      ...BALANCES.map((b) => ({ fieldId: fieldByName(b.field).id, role: "display", hidden: false })),
      { fieldId: trackerDate.id, role: "display", hidden: false },
      ...(catBinding ? [{ ...catBinding }] : []),
    ],
  };
  const newOcc = {
    id: newOccId, gridId: gid, userId: stale.userId, moduleId: newModId,
    parentId: stale.parentId ?? null, occurrences: [],
    fields: newFields,
    // Structural marker, so the convergence check above never has to match on a
    // LABEL - the user is free to rename this tile.
    meta: { accountsTile: true },
  };

  // The restored account keeps the shape the other three identity rows have.
  const restoredBindings = (staleMod.fieldBindings || [])
    .filter((b) => !BALANCES.some((x) => x.field && b.fieldId === fieldByName(x.field).id))
    .filter((b) => b.fieldId !== trackerDate.id);
  if (!restoredBindings.some((b) => b.fieldId === trackerScope.id)) {
    restoredBindings.push({ fieldId: trackerScope.id, role: "display", hidden: false });
  }
  const restoredFields = { ...(stale.fields || {}) };
  for (const b of BALANCES) delete restoredFields[fieldByName(b.field).id];
  delete restoredFields[trackerDate.id];
  restoredFields[trackerScope.id] = { value: "Total", flow: "in" };

  // The list position the mis-built tile held, so nothing jumps around.
  const nextList = (holder.occurrences || []).slice();
  const at = nextList.indexOf(stale.id);
  nextList.splice(at + 1, 0, newOccId);

  // ── the ops ───────────────────────────────────────────────────────────────
  const opPatches = [];
  for (const b of BALANCES) {
    const op = await Operation.findOne({ gridId: gid, name: b.op }).lean();
    if (!op) throw new Error(`operation "${b.op}" not found - refusing`);
    const before = JSON.stringify(op.pipeline || {});
    const after = before.split(`$allItemsById.${stale.id}`).join(`$allItemsById.${newOccId}`);
    if (after !== before) opPatches.push({ id: op.id, name: b.op, pipeline: JSON.parse(after) });
  }

  const nw = await Operation.findOne({ gridId: gid, name: "Net Worth" }).lean();
  if (!nw) throw new Error('operation "Net Worth" not found - refusing');
  const nwBefore = JSON.stringify(nw.pipeline || {});
  // The account MODULE ids its three rules name today.
  const acctModIds = new Set(
    occs.filter((o) => o.meta?.cumulative && modById[o.moduleId])
        .map((o) => o.moduleId)
  );
  let nwAfter = nwBefore;
  for (const mid of acctModIds) nwAfter = nwAfter.split(`"${mid}"`).join(`"${newModId}"`);
  const nwTerms = (nwBefore.match(/ADD_TO_VAR/g) || []).length;

  log(`  new tile "Accounts" (${newOccId}) with ${BALANCES.length} balances + Tracker Date`);
  log(`  carried values: ${Object.keys(newFields).length}`);
  log(`  restored "${RESTORE.label}" (${stale.id}) as an identity row`);
  log(`  balance ops repointed: ${opPatches.length}`, opPatches.map((p) => p.name).join(", "));
  log(`  Net Worth rules repointed: ${nwAfter !== nwBefore ? "yes" : "NO"} (${nwTerms} ADD terms)`);

  if (!apply) { log("  DRY RUN - nothing written"); return { ok: true, dryRun: true }; }

  await Module.create(newMod);
  await Occurrence.create(newOcc);
  await Module.updateOne(
    { id: staleMod.id, gridId: gid },
    { $set: { label: RESTORE.label, fieldBindings: restoredBindings } }
  );
  await Occurrence.updateOne(
    { id: stale.id, gridId: gid },
    { $set: { fields: restoredFields, meta: { ...(stale.meta || {}), cumulative: true } } }
  );
  await Occurrence.updateOne({ id: holder.id, gridId: gid }, { $set: { occurrences: nextList } });
  for (const p of opPatches) await Operation.updateOne({ id: p.id, gridId: gid }, { $set: { pipeline: p.pipeline } });
  if (nwAfter !== nwBefore) await Operation.updateOne({ id: nw.id, gridId: gid }, { $set: { pipeline: JSON.parse(nwAfter) } });

  log("  APPLIED");
  return { ok: true, newOccId, ops: opPatches.length };
}
