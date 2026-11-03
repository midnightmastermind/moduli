// 0486 — a link inside a row's notes is a link chip, like every other link (user 2026-11-03: "it should be the same
// as every other link btw. it should show a little arrow to open it up, thats contained in a minitextblock").
//
// 0485 moved the CPS Zoom details into a textblock with the links as plain link MARKS. The importer makes a link
// an `instanceTextblockInline` chip — its own role:"textblock" kind:"inline" occurrence carrying `meta.link`,
// parented to and listed by the text that embeds it (0394). This converts link marks in textblocks that live in a
// ROW's notes (parent is an instance) into that shape. Text without a link is untouched.
export const id = "0486-row-note-links-become-chips";
export const describe = "Link marks in row-note textblocks become link chips (instanceTextblockInline + meta.link).";
export const touches = ["modules", "occurrences"];

import { randomUUID } from "node:crypto";
import { compressTextmap, decompressTextmap } from "../utils/textmapCompression.js";

const linkOf = (n) => n?.type === "text" && (n.marks || []).find((m) => m.type === "link" && m.attrs?.href);

/** Pure: replace each link-marked text node with a chip node; `mint(label, url)` returns { occurrenceId, moduleId }. */
export function chipLinks(doc, mint) {
  let changed = 0;
  const walk = (node) => {
    if (!node || !Array.isArray(node.content)) return node;
    const content = node.content.map((c) => {
      const link = linkOf(c);
      if (!link) return walk(c);
      changed++;
      const ids = mint(c.text, link.attrs.href);
      return { type: "instanceTextblockInline", attrs: { occurrenceId: ids.occurrenceId, instanceId: ids.moduleId } };
    });
    return { ...node, content };
  };
  const next = walk(doc);
  return { doc: next, changed };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const gid = String(gridId);
  const tbMods = new Set((await Module.find({ gridId: gid, role: "textblock" }).select("id").lean()).map((m) => m.id));
  const instMods = new Set((await Module.find({ gridId: gid, role: "instance" }).select("id").lean()).map((m) => m.id));
  const tbs = await Occurrence.find({ gridId: gid, moduleId: { $in: [...tbMods] }, parentId: { $ne: null } }).lean();
  const parents = new Map((await Occurrence.find({ gridId: gid, id: { $in: tbs.map((t) => t.parentId) } }).select("id moduleId").lean()).map((p) => [p.id, p]));

  const newMods = [], newOccs = [], writes = [];
  for (const tb of tbs) {
    if (!instMods.has(parents.get(tb.parentId)?.moduleId)) continue;
    let tm; try { tm = decompressTextmap(tb.textmap); } catch { continue; }
    const listed = [];
    const { doc, changed } = chipLinks(tm, (label, url) => {
      const moduleId = randomUUID(), occurrenceId = randomUUID();
      const link = { kind: "url", url };
      newMods.push({ id: moduleId, userId: tb.userId, gridId: gid, role: "textblock", kind: "inline", label, fieldBindings: [], meta: { link } });
      newOccs.push({ id: occurrenceId, userId: tb.userId, gridId: gid, moduleId, parentId: tb.id, occurrences: [], fields: {}, meta: { link },
        textmap: compressTextmap({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: label }] }] }) });
      listed.push(occurrenceId);
      return { moduleId, occurrenceId };
    });
    if (changed) writes.push({ id: tb.id, doc, listed });
  }
  log(`${dryRun ? "[dry run] " : ""}${writes.length} textblock(s) · ${newOccs.length} link chip(s)`);
  if (dryRun || !writes.length) return { textblocks: writes.length, chips: newOccs.length };
  await Module.insertMany(newMods);
  await Occurrence.insertMany(newOccs);
  for (const w of writes) {
    await Occurrence.updateOne({ gridId: gid, id: w.id }, { $set: { textmap: compressTextmap(w.doc), updatedAt: new Date() }, $addToSet: { occurrences: { $each: w.listed } } });
  }
  return { textblocks: writes.length, chips: newOccs.length };
}
