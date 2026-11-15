// 0502 — the Glossary's links go downward as a bullet list, one mini-textblock per item (user, 2026-11-15: "make them
// going downward in a bulletpoint list (inside the textblocks with the minitextblocks)"). 0501 wrote each group as one
// line of chips separated by " · "; this rewrites those textblocks' text only — the chips, their listing and every id
// stay as they are. A bold lead ("Pages:") stays a line above its list. 0501 now builds lists itself (it calls this).
import { compressTextmap, decompressTextmap } from "../utils/textmapCompression.js";
import { ensureHoverLine } from "../../client/src/docs/trailingEmpty.js";

export const id = "0502-glossary-bullet-lists";
export const describe = "Glossary link lines become bullet lists (one link chip per item), and the empty lines saved after a section's links are dropped; text only, nothing deleted.";
export const touches = ["occurrences"];

const isChip = (n) => n?.type === "instanceTextblockInline";

/** A doc whose paragraphs hold chips → the same doc with each such paragraph as [lead line?, bulletList]. Pure.
 *  Returns null when nothing changes (no chip paragraphs, or already a list). */
export function toBulletList(doc) {
  if (!doc || !Array.isArray(doc.content)) return null;
  let changed = false;
  const content = [];
  for (const node of doc.content) {
    const kids = node?.type === "paragraph" ? node.content || [] : [];
    const chips = kids.filter(isChip);
    if (!chips.length) { content.push(node); continue; }
    changed = true;
    const lead = kids.filter((k) => k.type === "text" && (k.marks || []).some((m) => m.type === "bold"));
    if (lead.length) content.push({ type: "paragraph", content: lead.map((t) => ({ ...t, text: t.text.trim() })) });
    content.push({ type: "bulletList", content: chips.map((c) => ({ type: "listItem", content: [{ type: "paragraph", content: [c] }] })) });
  }
  return changed ? { ...doc, content } : null;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const gid = String(gridId);
  const pageMods = await Module.find({ gridId: gid, role: "page", kind: "doc", label: "Glossary" }).select("id").lean();
  const page = await Occurrence.findOne({ gridId: gid, moduleId: { $in: pageMods.map((m) => m.id) } }).lean();
  if (!page) { log("  no Glossary page (0501 first)"); return; }
  // Every occurrence under the page, through the listed children.
  const seen = new Set(); let frontier = [page.id]; const all = [];
  while (frontier.length) {
    const rows = await Occurrence.find({ gridId: gid, id: { $in: frontier } }).lean();
    frontier = [];
    for (const r of rows) { if (seen.has(r.id)) continue; seen.add(r.id); all.push(r); frontier.push(...(r.occurrences || [])); }
  }
  const tbMods = new Set((await Module.find({ gridId: gid, id: { $in: all.map((o) => o.moduleId) }, role: "textblock", kind: "doc" }).select("id").lean()).map((m) => m.id));
  const secMods = new Set((await Module.find({ gridId: gid, id: { $in: all.map((o) => o.moduleId) }, role: "container", kind: "doc" }).select("id").lean()).map((m) => m.id));
  const writes = [];
  let lists = 0, trimmed = 0;
  for (const o of all) {
    if (!o.textmap) continue;
    let doc; try { doc = decompressTextmap(o.textmap); } catch { continue; }
    let next = doc;
    if (tbMods.has(o.moduleId)) { const l = toBulletList(next); if (l) { next = l; lists++; } }
    // A section ends in ONE empty line: its hover line (docs/trailingEmpty). 0501 wrote none (no hover space) and a
    // click saved a second one into Web & dev (a blank space).
    if (secMods.has(o.moduleId)) { const t = ensureHoverLine(next); if (t !== next) { next = t; trimmed++; } }
    if (next !== doc) writes.push({ id: o.id, next });
  }
  log(`  ${lists} textblock(s) become bullet lists · ${trimmed} section(s) get exactly one hover line`);
  if (dryRun) return;
  for (const w of writes) await Occurrence.updateOne({ gridId: gid, id: w.id }, { $set: { textmap: compressTextmap(w.next), updatedAt: new Date() } });
  log("  applied. RESTART pm2.");
}
