// 0337 — the `***` a link chip PRINTS, which is not the label 0333 cleaned.
//
// User, 2026-09-17, on a video of the Alan Watts article:
// *"that video still shows *** not being resolved markdown inside minitextblocks"*.
//
// ── 0333 CLEANED THE WRONG FIELD, AND THE STORED DATA PROVES IT ────────────
//
// 0333 stripped markdown from inline chip MODULE LABELS and verified "21
// cleaned, 0 left" — measured on `Module.label`, which is still true:
//
//     inline modules                              1867
//     module labels carrying markdown                0
//
// But `InstanceTextblockInlineNode` does not render the module label. It renders
// `textmapToInlineText(occurrence.textmap)` — the chip's OWN textmap — and that
// is where the raw text lives:
//
//     {"type":"doc","content":[{"type":"paragraph","content":[
//       {"type":"text","text":"***The Book: On the Taboo Against Knowing Who You Are***"}]}]}
//
// So the repair was invisible to the thing it was meant to fix. *A migration
// that verifies the field it wrote rather than the field the renderer reads can
// report "0 left" and change nothing on screen.*
//
// ── SAME RULE, SAME STRIPPER ───────────────────────────────────────────────
//
// It reuses `stripInlineMd` — the importer's own — through 0333's plan helper
// shape, so the label pass and this one cannot disagree about what a clean chip
// says. Scoped to `kind:"inline"` textblocks exactly as 0333 was, and that
// scoping is the safety: 414 modules on this grid carry `**…**` in a label, and
// almost all are the codex `**[annotation]**` markers that `ANNOTATION_RE` keys
// on. A blanket "strip markdown from every textmap" pass would make every
// annotation read as an ordinary quote.
//
// A chip's own LINK, and every other node in the textmap, is untouched — only
// the TEXT it prints.

import { stripInlineMd } from "../services/markdownImporter.js";
import { decompressTextmap, compressTextmap } from "../utils/textmapCompression.js";

export const id = "0337-link-chip-textmaps-carry-raw-markdown";
export const description =
  "Strip leftover markdown emphasis from the textmap text of inline link chips — the field the chip actually renders.";
export const touches = ["occurrences"];

/**
 * Strip inline markdown from every text node, in place-ish (returns a new doc).
 * Returns null when nothing changed, so the caller skips the write.
 *
 * PURE — what changes is the whole risk, so it is testable without a database.
 */
export function stripTextmapMd(doc) {
  if (!doc || typeof doc !== "object") return null;
  let changed = 0;
  const walk = (node) => {
    if (!node || typeof node !== "object") return node;
    if (node.type === "text" && typeof node.text === "string") {
      const next = stripInlineMd(node.text);
      // COMPARED TRIMMED, so a row is rewritten only when a MARKER actually
      // goes. `stripInlineMd` also trims, and 65 of the 362 affected text nodes
      // differ by nothing but a leading space — which `textmapToInlineText`
      // already collapses before painting, so rewriting them is churn against
      // the user's own prose for no visible change.
      if (next && next.trim() !== node.text.trim()) { changed++; return { ...node, text: next }; }
      return node;
    }
    if (!Array.isArray(node.content)) return node;
    return { ...node, content: node.content.map(walk) };
  };
  const next = walk(doc);
  return changed ? { textmap: next, changed } : null;
}

export async function up({ gridId, models, log = console.log, dryRun = true }) {
  const { Occurrence, Module } = models;
  const gid = String(gridId);

  // Scoped by the MODULE's kind, the same discriminator 0333 used.
  const inlineIds = new Set(
    (await Module.find({ gridId: gid, kind: "inline" }).lean()).map((m) => m.id)
  );
  const occs = await Occurrence.find({ gridId: gid }).lean();

  const plan = [];
  for (const o of occs) {
    if (!inlineIds.has(o.moduleId) || !o.textmap) continue;
    // Textmaps are stored COMPRESSED — a raw scan reports "nothing to do" for
    // every row on this grid (the 0032 rule).
    const res = stripTextmapMd(decompressTextmap(o.textmap));
    if (res) plan.push({ _id: o._id, id: o.id, ...res });
  }

  const sample = (p) => {
    const t = [];
    const walk = (n) => { if (n?.type === "text") t.push(n.text); (n?.content || []).forEach(walk); };
    walk(p.textmap);
    return t.join(" ").slice(0, 70);
  };

  log(`inline chips: ${inlineIds.size} · textmaps carrying raw markdown: ${plan.length}`);
  for (const p of plan.slice(0, 25)) log(`  [${p.id}] -> ${JSON.stringify(sample(p))}`);
  if (plan.length > 25) log(`  … and ${plan.length - 25} more`);
  if (dryRun || !plan.length) return { changed: 0, planned: plan.length };

  for (const p of plan) {
    await Occurrence.updateOne({ _id: p._id }, { $set: { textmap: compressTextmap(p.textmap) } });
  }

  // Read the RESULT back out of Mongo, not off the log — and read the field the
  // RENDERER reads, which is the mistake this migration exists to correct.
  const after = await Occurrence.find({ gridId: gid }).lean();
  let left = 0;
  for (const o of after) {
    if (!inlineIds.has(o.moduleId) || !o.textmap) continue;
    if (stripTextmapMd(decompressTextmap(o.textmap))) left++;
  }
  if (left) throw new Error(`${left} chip textmap(s) still carry markdown after the write`);
  log(`cleaned ${plan.length} chip textmap(s); 0 left carrying markdown`);
  return { changed: plan.length };
}
