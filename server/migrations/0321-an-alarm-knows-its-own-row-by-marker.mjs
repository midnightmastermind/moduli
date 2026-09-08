// An alarm recognised its own row by NAME, so renaming it minted a second one.
//
// The last two label comparisons on the grid, and the ones `0320` correctly
// REFUSED to convert: an alarm's dedupe FIND asks *"did I already create today's
// row?"* and asked it as `label IS "⏰ 5 PM"`. Every marker already on those rows
// matches a WIDER set — keying it on the 5pm Time Slot matched 25 rows instead
// of 5, and the alarm would have concluded it had already fired and stopped
// creating anything. 0320's guard caught that (it requires the replacement to
// match the IDENTICAL set), which is why this needed its own marker rather than
// a reused one.
//
// So the alarm STAMPS one. `CREATE` has supported `identitySignature` all along
// — and stamps `meta.signatureUnique` with it, so the duplicate is refused
// server-side too (`0303`), not merely not-asked-for.
//
//   signature = `${type}:${time}`   ->  "alarm:17:00"
//
// Stable across a RENAME, which is the failure being fixed. Different for a
// different TIME — which is a different alarm, landing in a different slot
// anyway.
//
// ── EXISTING ROWS ARE STAMPED, OR THE FIX CAUSES THE BUG ONCE ─────────────
//
// Today's alarm row already exists and carries no signature. Without
// backfilling, the first fire after this ships would not recognise it and would
// create a second — the exact duplicate this removes. Every row the old
// label-FIND would have matched is stamped, and the migration REFUSES if it
// cannot tell which alarm a row belongs to.
//
// Both BUILDERS were changed in the same pass (`helpers/alarmOps.js` and the
// server's `makeAlarmOp`), because an alarm rebuilt from either would otherwise
// stop recognising rows this migration signed. Those twins have drifted before.
//
// Idempotent.
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0321-an-alarm-knows-its-own-row-by-marker";
export const description = "Alarms dedupe on an identity marker instead of their own name.";
export const touches = ["modules", "occurrences", "operations"];

const walk = (n, fn) => {
  if (Array.isArray(n)) return n.forEach((x) => walk(x, fn));
  if (n && typeof n === "object") { fn(n); Object.values(n).forEach((v) => walk(v, fn)); }
};

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const occs = await Occurrence.find({ gridId: gid }).lean();
  const mods = await Module.find({ gridId: gid }).lean();
  const ops  = await Operation.find({ gridId: gid }).lean();
  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));
  const labelOf = (o) => o && (o.label || modById[o.moduleId]?.label || "");

  const alarms = ops.filter((o) => o.alarm && o.alarm.time);
  if (!alarms.length) { log("  no alarm operations on this grid."); return; }

  let opsChanged = 0, rowsStamped = 0;
  for (const op of alarms) {
    // DERIVED FROM THE OP'S OWN CONFIG, exactly as both builders derive it —
    // a signature written down here would drift from them on the next edit.
    const signature = `${op.alarm.type || "alarm"}:${op.alarm.time}`;

    // The name the old FIND matched, so the rows to stamp are the rows it found.
    let oldName = null;
    walk(op.pipeline, (n) => {
      if (n.comparator === "IS" && n.left === "label" && typeof n.right === "string" && !n.right.startsWith("$"))
        oldName = n.right;
    });

    let touched = false;
    walk(op.pipeline, (n) => {
      if (n.comparator === "IS" && n.left === "label" && typeof n.right === "string" && !n.right.startsWith("$")) {
        n.left = "identitySignature"; n.right = signature; touched = true;
      }
      const c = n.config || {};
      if (c.type === "CREATE" && c.role === "instance" && c.identitySignature !== signature) {
        c.identitySignature = signature; touched = true;
      }
    });

    if (touched) {
      log(`  ${op.name}: dedupes on identitySignature "${signature}"` + (oldName ? ` (was label "${oldName}")` : ""));
      if (apply) await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { pipeline: op.pipeline } });
      opsChanged++;
    } else log(`  ${op.name}: already dedupes on "${signature}"`);

    // Backfill the rows the old FIND would have matched.
    if (!oldName) continue;
    const rows = occs.filter((o) => labelOf(o) === oldName && !o.identitySignature);
    // A row that already carries a DIFFERENT signature belongs to something
    // else; overwriting it would break whatever stamped it.
    const conflicting = occs.filter((o) => labelOf(o) === oldName
      && o.identitySignature && o.identitySignature !== signature);
    if (conflicting.length)
      throw new Error(`${conflicting.length} row(s) called "${oldName}" already carry another signature - refusing`);

    if (rows.length) {
      log(`      stamping ${rows.length} existing row(s) — without this, today's fire would create a duplicate`);
      if (apply) await Occurrence.updateMany(
        { gridId: gid, id: { $in: rows.map((r) => r.id) } },
        { $set: { identitySignature: signature, "meta.signatureUnique": true } });
      rowsStamped += rows.length;
    }
  }

  log(`  ${opsChanged} alarm op(s) ${apply ? "updated" : "would be updated"}, ${rowsStamped} row(s) stamped.`);

  // THE CONTROL: no label comparison may survive in an alarm pipeline, or the
  // rename hazard is still there and this reports success anyway.
  if (apply) {
    const after = await Operation.find({ gridId: gid }).lean();
    const left = [];
    for (const op of after.filter((o) => o.alarm))
      walk(op.pipeline, (n) => {
        if (n.comparator === "IS" && n.left === "label" && typeof n.right === "string" && !n.right.startsWith("$"))
          left.push(`${op.name}: label IS "${n.right}"`);
      });
    if (left.length) throw new Error(`an alarm still matches on a name: ${left.join(", ")}`);
    log(`  no alarm matches on a name.`);
  }
  if (!apply) log("  DRY RUN - pass --apply to write.");
}
