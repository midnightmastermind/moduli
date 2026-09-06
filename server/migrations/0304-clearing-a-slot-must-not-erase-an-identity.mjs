// `Schedule: Stamp Date & Time Slot` erased the Todo container's identity
// marker, and the copy-link fan-out spread the erasure to all eight copies.
//
// Repaired twice (`0292` this morning, again at 06:00 tonight). This is the
// cause. Reproduced through the real executor: a create trigger for the Todo
// container inside the Schedule panel emits
//
//     Time Slot  ->  Todo = undefined
//
// ── THE ELSE BRANCH IS RIGHT, AND IT DOES NOT KNOW ABOUT IDENTITY ──────────
//
// The op's shape is:
//
//     if $item.<Schedule Format> IS_NOT "slot"            <- not itself a slot
//       if $destContainer.<Schedule Format> IS "slot"
//         then Time Slot = $trigger.containerLabel        <- stamp the slot
//         else Time Slot = null                           <- THE NULLER
//
// That else is deliberate and was added for a real defect: a COPY carries the
// source's fields, so an item copied out of a 5:00pm slot onto a canvas would
// otherwise keep a slot it no longer sits in (2026-07-30).
//
// **But `Time Slot` is not only a placement — on a few containers it is an
// IDENTITY.** `Schedule: Build Schedule` FINDs the Todo container by
// `fields.<Time Slot>.value IS "Todo"`; the Alarm and Pomodoro ops find their
// slot the same way. Measured: no Todo occurrence carries `Schedule Format` at
// all, so the outer guard - written for slots - lets every one of them through
// into the clearing branch, and their destination is a day column rather than a
// slot, so the else fires. The fan-out then shares the null across the whole
// linked group, master included.
//
// ── THE DISCRIMINATOR ALREADY EXISTS IN THIS REPO ──────────────────────────
//
// `0006` faced exactly this when a blunt repair nulled the same markers, and
// wrote the rule down: **a value equal to the occurrence's OWN label is an
// identity marker (leave it); a value equal to a PARENT's label is the
// mis-stamp.** A slot named "12:00am" carrying "12:00am" is itself; a task
// carrying "12:00am" is placed there. So the clear is gated on the value NOT
// being the row's own name.
//
// Both `label` and `moduleLabel` are compared, because a collection item's
// label is `occ.label ?? module.label` and every Todo occurrence carries
// `label: null` with the text on its MODULE. Comparing one only would leave
// the guard inert on exactly the rows it exists for.
//
// ── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────
//
// It does not touch the fan-out. Sharing `Time Slot` across a linked group is
// still wrong in the same way sharing `Date` was (2026-08-29 (7) withheld the
// FILTER fields for precisely this reason - "the field that decides WHICH
// COLUMN a placement is in was being shared across placements"; Time Slot
// decides which SLOT, one level down). That is a change to the shared write
// path and wants its own pass. This stops the null being written at all,
// which is what was reaching the user.
import Field from "../models/Field.js";
import Operation from "../models/Operation.js";

export const id = "0304-clearing-a-slot-must-not-erase-an-identity";
export const description = "The Time Slot clear skips a row whose Time Slot IS its own name — that is an identity marker, not a placement.";
export const touches = ["fields", "operations"];

const rid = () => "g" + Math.random().toString(36).slice(2, 12);
const OP = "Schedule: Stamp Date & Time Slot";

// The UPDATE that CLEARS Time Slot: path names the field, value is null.
// Identified by shape; the sibling UPDATE in the same if writes
// `$trigger.containerLabel` and must not be touched.
function findClears(node, tsId, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const c = node[i]?.config || node[i];
      if (c?.type === "UPDATE" && String(c.path || "").includes(tsId) && (c.value === null || c.value === undefined)) {
        out.push({ arr: node, idx: i, node: node[i] });
        continue;                       // do not descend into a matched step
      }
      findClears(node[i], tsId, out);
    }
    return out;
  }
  Object.values(node).forEach((v) => findClears(v, tsId, out));
  return out;
}

const guardFor = (tsId) => ({
  operator: "AND",
  rules: [
    { id: rid(), left: `$item.fields.${tsId}.value`, comparator: "IS_NOT", right: "$item.label" },
    { id: rid(), left: `$item.fields.${tsId}.value`, comparator: "IS_NOT", right: "$item.moduleLabel" },
  ],
});

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const hits = fields.filter((f) => f.name === "Time Slot");
  if (hits.length !== 1) throw new Error(`field "Time Slot": ${hits.length} matches - refusing`);
  const ts = hits[0];

  const op = await Operation.findOne({ gridId: gid, name: OP }).lean();
  if (!op) throw new Error(`no "${OP}" - refusing`);

  const pipeline = JSON.parse(JSON.stringify(op.pipeline));
  if (JSON.stringify(pipeline).includes("$item.moduleLabel")) {
    log(`  ${OP}: clear already guarded - left alone`);
    return;
  }

  const clears = findClears(pipeline, ts.id);
  if (clears.length !== 1) throw new Error(`"${OP}": ${clears.length} Time Slot clears - refusing to guess`);

  const { arr, idx, node } = clears[0];
  arr[idx] = { id: rid(), type: "if", condition: guardFor(ts.id), then: [node], else: [] };

  log(`  ${OP}: the Time Slot clear now skips a row whose value IS its own name (label or moduleLabel)`);
  if (apply) await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { pipeline } });
  if (!apply) log("  DRY RUN - pass --apply to write.");
}
