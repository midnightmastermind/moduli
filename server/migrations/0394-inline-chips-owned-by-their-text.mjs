// server/migrations/0394-inline-chips-owned-by-their-text.mjs
//
// An inline chip belongs to the text that embeds it — parented to it and listed by it — which is
// what "Make inline textblock" has always done and what the importer does from now on
// (utils/inlineChipOwnership). Imported chips were listed by NOTHING (2026-10-09: 1,861 on poms,
// 1,573 on the rebuild), so deleting an imported page could never reach them. The user: "if it
// doesnt match poms, fix it on poms too". Only `occurrences` lists and EMPTY `parentId`s are
// written; textmaps are read (decompressed), never rewritten. Nothing deleted.

import { decompressTextmap } from "../utils/textmapCompression.js";
import { ownInlineChips } from "../utils/inlineChipOwnership.js";

export const id = "0394-inline-chips-owned-by-their-text";
export const describe = "Every inline chip is listed by (and, if parentless, parented to) the text that embeds it. Nothing deleted.";
export const touches = ["occurrences"];

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence } = models;
  const raw = await Occurrence.find({ gridId }, { id: 1, parentId: 1, occurrences: 1, textmap: 1 }).lean();
  const rows = [];
  for (const o of raw) {
    let textmap = null;
    if (o.textmap) { try { textmap = await decompressTextmap(o.textmap); } catch { textmap = null; } }
    rows.push({ id: o.id, parentId: o.parentId ?? null, occurrences: [...(o.occurrences || [])], textmap });
  }
  const before = new Map(rows.map((r) => [r.id, { parentId: r.parentId, n: r.occurrences.length }]));
  const changed = ownInlineChips(rows);
  const byId = new Map(rows.map((r) => [r.id, r]));
  let lists = 0, parents = 0;
  for (const id of changed) { const r = byId.get(id); const b = before.get(id); if (r.occurrences.length !== b.n) lists++; if (r.parentId !== b.parentId) parents++; }
  log(`${lists} text(s) gain chip listings · ${parents} chip(s) get a parent`);
  if (dryRun) return;
  for (const id of changed) {
    const r = byId.get(id); const b = before.get(id); const set = {};
    if (r.parentId !== b.parentId) set.parentId = r.parentId;
    if (Object.keys(set).length) await Occurrence.updateOne({ gridId, id, parentId: null }, { $set: set });
    if (r.occurrences.length !== b.n) {
      const added = r.occurrences.slice(b.n);
      await Occurrence.updateOne({ gridId, id }, { $addToSet: { occurrences: { $each: added } } });
    }
  }
  log("done. Restart the server (pm2).");
}
