// 0375 — Lookup rows labelled with Google's "unusual traffic" token get their
// real search back.
//
// User, 2026-10-01: *"my lookup page textblocks have a bunch of random
// characters and urls in each one and makes it look confusing"*. 0199 built the
// Lookup board from the Raindrop export's Google searches by reading `q=`; on
// Google's /sorry interstitial `q` is a TOKEN ("EgRIh_REGNjVzM0GIij…") and the
// search is inside `continue`. searchTermOf now reads it (same commit); this
// relabels the rows already made, from the same export.
//
// A token whose search already has its own row is a duplicate and is REMOVED
// (unlisted, deleted). Anything the export cannot resolve is left alone and
// reported. Idempotent: a relabelled row no longer looks like a token.

import fs from "node:fs";
import { parseCsv, searchTermOf, GOOGLE_SORRY_TOKEN } from "../utils/raindropImport.js";
import { exportPath } from "./0199-bookmarks-from-raindrop.mjs";

export const id = "0375-lookup-search-tokens";
export const describe = "Relabel Lookup rows named with Google's interstitial token to the real search (from the Raindrop export). DELETES a token row whose search already has its own row.";
export const touches = ["occurrences", "modules"];

/** PURE: token -> real search, from the export's Google URLs. */
export function tokenSearches(rows) {
  const out = new Map();
  for (const r of rows || []) {
    let u; try { u = new URL(String(r.url || "")); } catch { continue; }
    const q = (u.searchParams.get("q") || "").trim();
    if (!GOOGLE_SORRY_TOKEN.test(q)) continue;
    const real = searchTermOf(r.url);
    if (real) out.set(q.toLowerCase(), real);
  }
  return out;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Folder } = models;
  const file = exportPath();
  if (!fs.existsSync(file)) throw new Error(`Raindrop export not found at ${file} (set RAINDROP_CSV)`);
  const map = tokenSearches(parseCsv(fs.readFileSync(file, "utf8")));
  const lf = await Folder.findOne({ gridId: String(gridId), name: "Lookup" }).lean();
  if (!lf) { log("no Lookup folder — nothing to do."); return; }
  const pages = await Occurrence.find({ parentId: lf.id }).lean();
  let board = null;
  for (const p of pages) for (const k of p.occurrences || []) { const c = await Occurrence.findOne({ id: k }).lean(); if ((c?.occurrences || []).length > (board?.occurrences?.length || 0)) board = c; }
  if (!board) { log("no Lookup board — nothing to do."); return; }
  const rows = await Occurrence.find({ id: { $in: board.occurrences } }).lean();
  const mods = new Map((await Module.find({ id: { $in: rows.map((r) => r.moduleId) } }).lean()).map((m) => [m.id, m]));
  const labelOf = (r) => r.label || mods.get(r.moduleId)?.label || "";
  const existing = new Set(rows.filter((r) => !GOOGLE_SORRY_TOKEN.test(labelOf(r))).map((r) => labelOf(r).trim().toLowerCase()));
  let renamed = 0, removed = 0, unresolved = 0;
  for (const r of rows) {
    const label = labelOf(r);
    if (!GOOGLE_SORRY_TOKEN.test(label)) continue;
    const real = map.get(label.toLowerCase());
    if (!real) { unresolved++; continue; }
    const key = real.trim().toLowerCase();
    if (existing.has(key)) {
      removed++;
      if (!dryRun) {
        await Occurrence.updateMany({ occurrences: r.id }, { $pull: { occurrences: r.id } });
        await Occurrence.deleteOne({ id: r.id });
        if (!(await Occurrence.exists({ moduleId: r.moduleId }))) await Module.deleteOne({ id: r.moduleId });
      }
      continue;
    }
    existing.add(key);
    renamed++;
    if (!dryRun) {
      const meta = { ...(r.meta || {}), raindropId: `l:${key}` };
      if (r.label) await Occurrence.updateOne({ id: r.id }, { $set: { label: real, meta } });
      else { await Module.updateOne({ id: r.moduleId }, { $set: { label: real } }); await Occurrence.updateOne({ id: r.id }, { $set: { meta } }); }
    }
  }
  log(`export resolves ${map.size} token(s); renamed ${renamed}, removed ${removed} duplicate(s), ${unresolved} unresolved.`);
}
