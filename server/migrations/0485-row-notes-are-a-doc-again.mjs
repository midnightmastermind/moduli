// 0485 — a row's notes drawer is a doc again: typing on an empty line makes a textblock.
//
// User 2026-11-03: "the notes editor should be autocreating textblocks there, just like a doc."
// 0212 pointed every instance's notes body at the `Notes` text FIELD (grid.meta.instanceBodyLink), and a field
// editor is plain text — it cannot hold a textblock. Without the binding the drawer renders DocContent over the
// row's own textmap, which mints textblocks like any doc.
//
// Measured before writing this: Notes values exist only on the CPS Class rows (written 2026-11-03), no operation
// reads the field, no module binds it, and no instance carries body text in its textmap. So:
//   1. unset grid.meta.instanceBodyLink;
//   2. each row holding a Notes value gets that text as ONE textblock in its own textmap (rows of one copy-link
//      group share the textblock, since the group shares its textmap), and the Notes value is cleared.
// The Notes field itself stays (it is harmless and someone may bind it on purpose).
export const id = "0485-row-notes-are-a-doc-again";
export const describe = "Row notes drawer back to the row's own doc (textblocks mint); Notes field values move into a textblock.";
export const touches = ["modules", "occurrences"];

import { randomUUID } from "node:crypto";
import { compressTextmap, decompressTextmap } from "../utils/textmapCompression.js";

const isDoc = (v) => v && typeof v === "object" && v.type === "doc" && Array.isArray(v.content);
const textToDoc = (s) => ({ type: "doc", content: String(s).split(/\n/).map((l) => (l ? { type: "paragraph", content: [{ type: "text", text: l }] } : { type: "paragraph" })) });

/** Pure: the row textmap that shows the textblock, keeping any body content the row already had. */
export function bodyWithTextblock(existing, { moduleId, occurrenceId }) {
  const node = { type: "instanceTextblock", attrs: { instanceId: moduleId, occurrenceId } };
  const content = (isDoc(existing) ? existing.content : []).filter((n) => !(n.type === "paragraph" && !(n.content || []).length));
  if (content.some((n) => n.attrs?.occurrenceId === occurrenceId)) return null;
  return { type: "doc", content: [node, ...content, { type: "paragraph" }] };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Grid, Field, Occurrence, Module } = models;
  const grid = await Grid.findById(gridId).select("meta userId").lean();
  const bound = grid?.meta?.instanceBodyLink?.selfField || null;
  const notes = await Field.find({ gridId, name: "Notes", type: "text" }).lean();
  const notesId = bound || (notes.length === 1 ? notes[0].id : null);

  const rows = notesId ? await Occurrence.find({ gridId, [`fields.${notesId}.value`]: { $nin: [null, ""] } }).lean() : [];
  const groups = new Map();
  for (const r of rows) {
    const key = r.linkedGroupId || `solo:${r.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  log(`  binding ${bound ? JSON.stringify(grid.meta.instanceBodyLink) : "(none)"} · rows with a Notes value ${rows.length} in ${groups.size} group(s)`);

  const newMods = [], newOccs = [], rowWrites = [];
  for (const members of groups.values()) {
    const first = members[0];
    const raw = first.fields[notesId].value;
    const doc = isDoc(raw) ? raw : textToDoc(raw);
    const modId = randomUUID(), occId = randomUUID();
    newMods.push({ id: modId, userId: String(first.userId || grid.userId), gridId: String(gridId), role: "textblock", kind: "doc", label: "", fieldBindings: [], meta: {} });
    newOccs.push({ id: occId, userId: String(first.userId || grid.userId), gridId: String(gridId), moduleId: modId, parentId: first.id, occurrences: [], fields: {}, meta: {}, textmap: compressTextmap(doc) });
    for (const r of members) {
      let tm = null; try { tm = r.textmap ? decompressTextmap(r.textmap) : null; } catch { tm = null; }
      const next = bodyWithTextblock(tm, { moduleId: modId, occurrenceId: occId });
      rowWrites.push({ id: r.id, textmap: next });
    }
  }
  log(`${dryRun ? "[dry run] " : ""}unset binding · ${newOccs.length} textblock(s) · ${rowWrites.length} row(s) rewritten`);
  if (dryRun) return { rows: rows.length };

  if (bound) await Grid.updateOne({ _id: gridId }, { $unset: { "meta.instanceBodyLink": "" } });
  if (newMods.length) await Module.insertMany(newMods);
  if (newOccs.length) await Occurrence.insertMany(newOccs);
  for (const w of rowWrites) {
    const $set = { updatedAt: new Date() };
    if (w.textmap) $set.textmap = compressTextmap(w.textmap);
    await Occurrence.updateOne({ gridId, id: w.id }, { $set, $unset: { [`fields.${notesId}`]: "" } });
  }
  return { rows: rows.length, textblocks: newOccs.length };
}
