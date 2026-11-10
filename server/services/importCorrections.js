// services/importCorrections.js
//
// YOUR FIXES TEACH THE CLEAN-UP (smarter imports Task 8). When you edit a textblock of a page imported in the
// last 14 days, the text it held and your version are saved as one ImportCorrection. The clean-up
// (services/importEnrich) hands the newest few to Ollama as worked examples — same kind of import and same
// site first. One record per textblock per 10 minutes: later edits in that window update its `after`.
// Called from update_occurrence for a user's own action only, never awaited there, and it never throws.
import ImportCorrection from "../models/ImportCorrection.js";
import { decompressTextmap } from "../utils/textmapCompression.js";

export const CORRECTION_WINDOW_DAYS = 14;
export const CORRECTION_MERGE_MS = 10 * 60 * 1000;
const MAX_HOPS = 6;
const EXAMPLE_CHARS = 1500;

/** A textmap's text: paragraphs (and headings) joined by blank lines. Pure. */
export function textmapText(textmap) {
  const tm = decompressTextmap(textmap);
  const block = (n) => (n?.content || []).map((c) => (c.type === "text" ? c.text : c.type === "hardBreak" ? "\n" : block(c))).join("");
  return (tm?.content || []).map(block).filter((t) => t.trim()).join("\n\n");
}

/** The import root a textblock belongs to: walk parentId up to an occurrence carrying meta.importSource. */
export function importRootOf(occ, occurrencesById) {
  let cur = occ;
  for (let i = 0; i <= MAX_HOPS && cur; i++) {
    if (cur.meta?.importSource) return cur;
    cur = cur.parentId ? occurrencesById?.[cur.parentId] : null;
  }
  return null;
}

const hostOf = (u) => { try { return new URL(u).hostname; } catch { return null; } };

export async function recordCorrection({ occurrence, prevTextmap, nextTextmap, uc, userId, gridId, now = new Date() }, deps = {}) {
  try {
    const Model = deps.model || ImportCorrection;
    if (!occurrence?.id || !userId || !gridId) return null;
    const mod = uc?.modulesById?.[occurrence.moduleId];
    if (mod?.role !== "textblock") return null;
    const root = importRootOf({ ...(uc?.occurrencesById?.[occurrence.id] || {}), ...occurrence }, uc?.occurrencesById);
    if (!root) return null;
    const at = Date.parse(root.meta?.importedAt || "");
    if (!Number.isFinite(at) || now - at > CORRECTION_WINDOW_DAYS * 86400000) return null;
    const after = textmapText(nextTextmap);
    const recent = await Model.findOne({ userId, occurrenceId: occurrence.id, createdAt: { $gt: new Date(now - CORRECTION_MERGE_MS) } })
      .sort({ createdAt: -1 }).lean();
    if (recent) {
      await Model.updateOne({ _id: recent._id }, { $set: { after, updatedAt: now } });
      return { updated: true };
    }
    const before = textmapText(prevTextmap);
    if (before === after) return null;
    const src = root.meta.importSource || {};
    await Model.create({ userId, gridId, rootOccurrenceId: root.id, occurrenceId: occurrence.id,
      kind: src.kind || null, site: hostOf(src.url), sourceUrl: src.url || null, before, after, createdAt: now, updatedAt: now });
    return { created: true };
  } catch (err) {
    console.warn("[importCorrections] not recorded:", err?.message || err);
    return null;
  }
}

/** The newest corrections to show Ollama: same kind + site first, then same kind. */
export async function examplesFor({ userId, gridId, kind, site = null, limit = 3 }, deps = {}) {
  const Model = deps.model || ImportCorrection;
  const out = [];
  const seen = new Set();
  const take = (rows) => { for (const r of rows) { if (out.length >= limit || seen.has(String(r._id))) continue; seen.add(String(r._id)); out.push(r); } };
  if (site) take(await Model.find({ userId, gridId, kind, site }).sort({ createdAt: -1 }).limit(limit).lean());
  if (out.length < limit) take(await Model.find({ userId, gridId, kind }).sort({ createdAt: -1 }).limit(limit * 2).lean());
  return out.map((r) => ({ before: String(r.before || "").slice(0, EXAMPLE_CHARS), after: String(r.after || "").slice(0, EXAMPLE_CHARS) }));
}
