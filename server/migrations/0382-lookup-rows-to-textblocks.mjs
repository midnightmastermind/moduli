// 0382 — the Lookup board's rows become TEXTBLOCKS with their text in the body.
//
// User, 2026-10-02 (screenshot): *"look at the lookup page and see how all those
// textblocks still are labels and not body"*. The 244 rows were minted by the
// Raindrop import (`meta.raindropId` "l:<query>") as plain INSTANCES whose text
// is the module label, so they render as a one-line header. The one row added
// since by sharing is a textblock with the text in its body — this makes the
// rest match it.
//
// Measured before writing: 244 instances, 244 distinct modules, each placed
// exactly once (here), 0 field bindings, 0 field values, 0 children. So the
// conversion loses nothing: role -> textblock, kind -> doc, the label moves into
// the textmap as one paragraph and the module label is cleared (a textblock
// shows its body, not a label). Scoped to rows of THIS board that still carry
// the import's "l:" id and no textmap; idempotent.

import { compressTextmap } from "../utils/textmapCompression.js";

export const id = "0382-lookup-rows-to-textblocks";
export const describe = "Turn the Lookup board's imported label-only rows into textblocks whose body holds the text.";
export const touches = ["occurrences", "modules"];

export function bodyFor(text) {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const gid = String(gridId);
  const boardMods = await Module.find({ gridId: gid, role: "container", label: "Lookup" }, { id: 1 }).lean();
  const boards = await Occurrence.find({ gridId: gid, moduleId: { $in: boardMods.map((m) => m.id) } }).lean();
  if (boards.length !== 1) throw new Error(`expected one Lookup container, found ${boards.length}`);
  const board = boards[0];
  const kids = await Occurrence.find({ gridId: gid, id: { $in: board.occurrences || [] } }).lean();
  const mods = new Map((await Module.find({ gridId: gid, id: { $in: kids.map((k) => k.moduleId) } }).lean()).map((m) => [m.id, m]));
  const plan = [];
  for (const k of kids) {
    const m = mods.get(k.moduleId);
    if (!m || m.role !== "instance" || k.textmap) continue;
    if (!String(k.meta?.raindropId || "").startsWith("l:")) continue;
    if ((m.fieldBindings || []).length || Object.keys(k.fields || {}).length || (k.occurrences || []).length) {
      throw new Error(`row ${k.id} carries fields or children — refusing to convert it`);
    }
    const others = await Occurrence.countDocuments({ moduleId: m.id, id: { $ne: k.id } });
    if (others) throw new Error(`row ${k.id}'s module is placed elsewhere — refusing`);
    const text = (k.label || m.label || "").trim();
    if (!text) continue;
    plan.push({ occ: k, mod: m, text });
  }
  log(`Lookup ${board.id}: ${plan.length} rows -> textblocks (e.g. ${plan.slice(0, 3).map((p) => JSON.stringify(p.text)).join(", ")})`);
  if (dryRun || !plan.length) return;
  await Module.bulkWrite(plan.map((p) => ({ updateOne: { filter: { id: p.mod.id }, update: { $set: { role: "textblock", kind: "doc", label: "" } } } })));
  await Occurrence.bulkWrite(plan.map((p) => ({ updateOne: { filter: { id: p.occ.id }, update: { $set: { textmap: compressTextmap(bodyFor(p.text)), label: null } } } })));
}
