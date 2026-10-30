// 0459 — every plain-text table cell becomes a doc chip (a mini textblock, `instanceTextblockInline`), so a cell's entry
// is draggable like a doc chip (user, 2026-10-30: "are you also going to convert all the tables to using the doc chips?
// just the ones that arent instances already"). Typing into an empty cell already makes one (helpers/typedChip).
// A cell holding an embed (an instance, a chip) is left as it is; so are empty cells. The chip keeps the cell's inline
// content (marks included), and a literal `**bold**` left by the importer becomes real bold. The chip is PARENTED to
// its table and not listed by it (a table draws its list as child rows) — the same shape the typing rule makes.
import { randomUUID } from "node:crypto";
import { compressTextmap } from "../utils/textmapCompression.js";

export const id = "0459-table-cells-become-chips";
export const describe = "Turns every plain-text cell of every table container into a doc chip holding that text.";
export const touches = ["occurrences", "modules"];

const EMBEDS = new Set(["moduleEmbed", "instancePill", "instanceTextblockInline"]);

/** Inline nodes with `**x**` in text turned into a bold mark. PURE. */
export function boldFromMarkdown(inline) {
  const out = [];
  for (const n of inline || []) {
    if (n?.type !== "text" || typeof n.text !== "string" || !n.text.includes("**")) { out.push(n); continue; }
    const parts = n.text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
    for (const p of parts) {
      const m = /^\*\*([^*]+)\*\*$/.exec(p);
      const marks = [...(n.marks || [])];
      if (m && !marks.some((k) => k.type === "bold")) marks.push({ type: "bold" });
      out.push({ ...n, text: m ? m[1] : p, ...(m || n.marks ? { marks } : {}) });
    }
  }
  return out;
}

/** The cell's inline content when it is a convertible text cell, else null. PURE. */
export function cellInline(doc) {
  if (!doc || typeof doc !== "object") return null;
  let embed = false;
  const walk = (n) => { if (!n || typeof n !== "object") return; if (EMBEDS.has(n.type)) embed = true; (n.content || []).forEach(walk); };
  walk(doc);
  if (embed) return null;
  const paras = (doc.content || []).filter((p) => p?.type === "paragraph");
  if (paras.length !== (doc.content || []).length) return null; // lists / tables inside a cell: leave
  const inline = [];
  paras.forEach((p, i) => { if (i) inline.push({ type: "hardBreak" }); inline.push(...(p.content || [])); });
  const text = inline.map((n) => n.text || "").join("").trim();
  return text ? boldFromMarkdown(inline) : null;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const tableMods = await Module.find({ gridId, role: "container", kind: "table" }).select("id label").lean();
  const tables = await Occurrence.find({ gridId, moduleId: { $in: tableMods.map((m) => m.id) } }).lean();
  let total = 0; const plan = [];
  for (const t of tables) {
    const cells = t.meta?.table?.cells || {};
    const conv = Object.entries(cells).map(([k, d]) => [k, cellInline(d)]).filter(([, inl]) => inl);
    if (!conv.length) continue;
    plan.push({ t, conv }); total += conv.length;
    log(`  ${tableMods.find((m) => m.id === t.moduleId)?.label} ${t.id}: ${conv.length} cells`);
  }
  log(`  ${total} cells in ${plan.length} tables`);
  if (dryRun || !total) return;
  const now = new Date();
  for (const { t, conv } of plan) {
    const mods = []; const occs = []; const cells = { ...t.meta.table.cells };
    for (const [k, inline] of conv) {
      const modId = randomUUID(); const occId = randomUUID();
      mods.push({ id: modId, userId: t.userId, gridId, role: "textblock", kind: "inline", label: "", createdAt: now, updatedAt: now });
      occs.push({ id: occId, userId: t.userId, gridId, moduleId: modId, parentId: t.id, occurrences: [], fields: {}, meta: {},
        textmap: compressTextmap({ type: "doc", content: [{ type: "paragraph", content: inline }] }), createdAt: now, updatedAt: now });
      cells[k] = { type: "doc", content: [{ type: "paragraph", content: [{ type: "instanceTextblockInline", attrs: { instanceId: modId, occurrenceId: occId } }] }] };
    }
    await Module.insertMany(mods);
    await Occurrence.insertMany(occs);
    await Occurrence.updateOne({ gridId, id: t.id }, { $set: { "meta.table.cells": cells, updatedAt: now } });
  }
  const after = await Occurrence.find({ gridId, moduleId: { $in: tableMods.map((m) => m.id) } }).lean();
  const left = after.reduce((n, t) => n + Object.values(t.meta?.table?.cells || {}).filter((d) => cellInline(d)).length, 0);
  if (left) throw new Error(`${left} text cells left`);
  log("  applied. RESTART pm2.");
}
