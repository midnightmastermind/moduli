// 0491 — a copy of a row shows the row's notes; a row whose notes were wiped gets them back.
//
// User 2026-11-12: "only a handful of my cps occurrences show the meeting links in the body notes". Measured: every
// CPS Class original in Tasks › Appointments embeds its notes textblock, but the copies the operations made (the
// Schedule start-slot copy, the Duration copies, feed copies) were minted with no textmap. And on Nov 5 and Nov 12 an
// empty copy's save fanned its empty body over the ORIGINAL (the textblock survived, parented to the row and embedded
// nowhere). The client now carries the body on a copy (helpers/carriedBody) and the server no longer fans an empty
// body over text (textmapFansTo). This repairs what is stored:
//   1. a row whose body is empty and which owns an un-embedded textblock with text gets it embedded again;
//   2. a childless row whose body is empty takes the body of the row it copies (meta.copyLinkSource / feedSourceId /
//      spanOf, else a copy-link sibling) when that row is childless and has one.
export const id = "0491-copies-show-their-notes";
export const describe = "Copies show their source row's notes; rows whose notes were wiped by an empty copy get them back.";
export const touches = ["occurrences"];

import { compressTextmap, decompressTextmap } from "../utils/textmapCompression.js";

const read = (tm) => { if (!tm) return null; try { return typeof tm === "string" ? decompressTextmap(tm) : tm; } catch { return null; } };
export function hasContent(n) {
  if (!n || typeof n !== "object") return false;
  if (n.type === "text") return !!(n.text && n.text.trim());
  if (n.type && n.type !== "doc" && n.type !== "paragraph" && n.type !== "hardBreak") return true;
  return (n.content || []).some(hasContent);
}
const embedsOf = (n, out = []) => { if (!n || typeof n !== "object") return out; if (n.attrs?.occurrenceId) out.push(n.attrs.occurrenceId); for (const c of n.content || []) embedsOf(c, out); return out; };

/** Pure plan: `[{ id, textmap, why }]`. `rows` are occurrences with textmaps read and their module's `role`;
 *  `textblockModuleIds` a Set. Only an INSTANCE gets a lost embed back — a table's cell chips are parented to the
 *  table and embedded in no textmap by design (0459). */
export function planNotes(rows, textblockModuleIds) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const embedded = new Set();
  for (const r of rows) for (const e of embedsOf(r.tm)) embedded.add(e);
  const body = new Map(rows.map((r) => [r.id, r.tm]));
  const plan = [];
  const childless = (r) => !(r.occurrences || []).length;

  // 1. a lost embed
  const lost = new Map();
  for (const t of rows) {
    if (!textblockModuleIds.has(t.moduleId) || !t.parentId || embedded.has(t.id) || !hasContent(t.tm)) continue;
    if (!lost.has(t.parentId)) lost.set(t.parentId, []);
    lost.get(t.parentId).push(t);
  }
  for (const [rowId, tbs] of lost) {
    const r = byId.get(rowId);
    if (!r || r.role !== "instance" || hasContent(r.tm) || !childless(r)) continue;
    const tm = { type: "doc", content: [...tbs.map((t) => ({ type: "instanceTextblock", attrs: { instanceId: t.moduleId, occurrenceId: t.id } })), { type: "paragraph" }] };
    body.set(rowId, tm);
    plan.push({ id: rowId, textmap: tm, why: "re-embed" });
  }

  // 2. copies take their source's body
  const groups = new Map();
  for (const r of rows) if (r.linkedGroupId) { if (!groups.has(r.linkedGroupId)) groups.set(r.linkedGroupId, []); groups.get(r.linkedGroupId).push(r); }
  const usable = (s) => s && childless(s) && hasContent(body.get(s.id)) && !textblockModuleIds.has(s.moduleId);
  // Repeated until nothing changes: a Duration copy names the start-slot copy, which is itself a copy.
  for (let changed = true, guard = 0; changed && guard < 10; guard++) {
    changed = false;
    for (const c of rows) {
      if (textblockModuleIds.has(c.moduleId) || !childless(c) || hasContent(body.get(c.id))) continue;
      const m = c.meta || {};
      let src = [m.copyLinkSource, m.feedSourceId, m.spanOf].map((id) => id && byId.get(id)).find(usable) || null;
      if (!src && c.linkedGroupId) src = (groups.get(c.linkedGroupId) || []).find((s) => s.id !== c.id && usable(s)) || null;
      if (!src) continue;
      const tm = JSON.parse(JSON.stringify(body.get(src.id)));
      body.set(c.id, tm);
      plan.push({ id: c.id, textmap: tm, why: `copy of ${src.id}` });
      changed = true;
    }
  }
  return plan;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const tbMods = await Module.find({ gridId: String(gridId), role: "textblock" }).select("id").lean();
  const textblockModuleIds = new Set(tbMods.map((m) => m.id));
  const raw = await Occurrence.find({ gridId: String(gridId) }).select("id moduleId parentId occurrences textmap meta linkedGroupId label").lean();
  const roleOf = new Map((await Module.find({ gridId: String(gridId) }).select("id role").lean()).map((m) => [m.id, m.role]));
  const rows = raw.map((r) => ({ ...r, role: roleOf.get(r.moduleId) || null, tm: read(r.textmap) }));
  const plan = planNotes(rows, textblockModuleIds);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const counts = {};
  for (const p of plan) { const k = `${p.why.startsWith("copy") ? "copy" : p.why} · ${byId.get(p.id)?.label || "(no label)"}`; counts[k] = (counts[k] || 0) + 1; }
  for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) log(`  ${n} × ${k}`);
  log(`${dryRun ? "[dry run] " : ""}${plan.length} row(s) get notes`);
  if (dryRun) return { rows: plan.length };
  for (const p of plan) await Occurrence.updateOne({ gridId: String(gridId), id: p.id }, { $set: { textmap: compressTextmap(p.textmap), updatedAt: new Date() } });
  return { rows: plan.length };
}
