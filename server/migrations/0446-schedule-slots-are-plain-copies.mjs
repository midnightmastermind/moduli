// 0446 — a day column's time slots are plain COPIES of the template's, not
// copy-links (user, 2026-10-27: "just copy the timeslots … from the original").
//
// Since 0445 a copy-link group shares every field, Date included. A slot has
// no reason to share anything with the template slot or the other days' slots:
// the day column above it holds the date, and what sits inside each slot is
// that day's own rows. Linking them only meant one stray write on any slot
// reached all 38.
//
// Two parts:
//  1. `Schedule: Build Day` and `Schedule: Combine Days` copy the template slot
//     with COPY_LINK `linked: false` — a copy that still carries
//     `meta.copyLinkSource` (the original's id), which is how both ops find
//     "this day's copy of that slot". Their FINDs are unchanged.
//  2. Existing slot links are dissolved: every container in a linked group made
//     only of containers whose Schedule Format is "slot" (or Time Slot "Todo")
//     loses its linkedGroupId. Rows are never touched.
export const id = "0446-schedule-slots-are-plain-copies";
export const describe = "Schedule slots are plain copies of the template (COPY_LINK linked:false); existing slot links dissolved.";
export const touches = ["operations", "occurrences"];

const OPS = { "Schedule: Build Day": "$tplChildId", "Schedule: Combine Days": "$tplSlotId" };

/** Pure: set linked:false on every COPY_LINK step whose source is `sourceVar`. Returns [pipeline, count]. */
export function unlinkSlotCopies(pipeline, sourceVar) {
  let n = 0;
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = walk(v);
    const cfg = out.config;
    if (out.type === "action" && cfg?.type === "COPY_LINK" && cfg.sourceId === sourceVar && cfg.linked !== false) {
      out.config = { ...cfg, linked: false };
      n++;
    }
    return out;
  };
  return [walk(pipeline), n];
}

/** Pure: ids of slot containers whose linked group holds nothing but slot containers. */
export function slotLinkMembers(occurrences, roleOfModule, { formatFieldId, slotFieldId }) {
  const isSlot = (o) => roleOfModule(o.moduleId) === "container"
    && (o.fields?.[formatFieldId]?.value === "slot" || o.fields?.[slotFieldId]?.value === "Todo");
  const groups = new Map();
  for (const o of occurrences) if (o.linkedGroupId) {
    if (!groups.has(o.linkedGroupId)) groups.set(o.linkedGroupId, []);
    groups.get(o.linkedGroupId).push(o);
  }
  const ids = [];
  for (const members of groups.values()) if (members.every(isSlot)) ids.push(...members.map((o) => o.id));
  return ids;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation, Occurrence, Module, Field } = models;

  const planned = [];
  for (const [name, sourceVar] of Object.entries(OPS)) {
    const op = await Operation.findOne({ gridId, name }).lean();
    if (!op) { log(`  "${name}" not on this grid — skipped`); continue; }
    const [pipeline, n] = unlinkSlotCopies(op.pipeline, sourceVar);
    log(`  "${name}": ${n} COPY_LINK step(s) of ${sourceVar} -> linked:false`);
    if (n) planned.push({ op, pipeline });
  }

  const fields = await Field.find({ gridId, name: { $in: ["Schedule Format", "Time Slot"] } }).lean();
  const formatFieldId = fields.find((f) => f.name === "Schedule Format")?.id;
  const slotFieldId = fields.find((f) => f.name === "Time Slot")?.id;
  if (!formatFieldId || !slotFieldId) { log("  no Schedule Format / Time Slot field — slot links left alone"); }
  let unlink = [];
  if (formatFieldId && slotFieldId) {
    if (fields.filter((f) => f.name === "Schedule Format").length > 1 || fields.filter((f) => f.name === "Time Slot").length > 1) {
      throw new Error("Schedule Format / Time Slot is not unique on this grid");
    }
    const occs = await Occurrence.find({ gridId, linkedGroupId: { $ne: null } }, { id: 1, moduleId: 1, linkedGroupId: 1, fields: 1 }).lean();
    const roles = new Map((await Module.find({ gridId, id: { $in: [...new Set(occs.map((o) => o.moduleId))] } }, { id: 1, role: 1 }).lean()).map((m) => [m.id, m.role]));
    unlink = slotLinkMembers(occs, (mid) => roles.get(mid), { formatFieldId, slotFieldId });
    const groups = new Set(occs.filter((o) => unlink.includes(o.id)).map((o) => o.linkedGroupId));
    log(`  ${unlink.length} slot container(s) in ${groups.size} linked group(s) lose their link`);
  }
  if (dryRun) return;

  for (const { op, pipeline } of planned) await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline } });
  if (unlink.length) await Occurrence.updateMany({ gridId, id: { $in: unlink } }, { $set: { linkedGroupId: null, updatedAt: new Date() } });

  for (const { op } of planned) {
    const after = await Operation.findOne({ gridId, id: op.id }).lean();
    if (unlinkSlotCopies(after.pipeline, OPS[op.name])[1]) throw new Error(`"${op.name}" still copy-links its slots`);
  }
  const left = await Occurrence.countDocuments({ gridId, id: { $in: unlink }, linkedGroupId: { $ne: null } });
  if (left) throw new Error(`${left} slot(s) still linked`);
  log("  applied. RESTART pm2.");
}
