// 0495 — a quote's words become a real text body, so its links are editable mini textblocks (link chips).
//
// User 2026-11-12: "make sure minitextblocks work inside quotes so they can be editable and accessed". A quote
// artifact stored its words as a plain string (`module.meta.quote`) and the card drew them with linkifyText, so a link
// was a bare anchor: no chip, no ↗ / 🌐, nothing to edit. Each quote OCCURRENCE now gets a textmap built from that
// string by the importer's own parseInline — links become `instanceTextblockInline` chips (role textblock, kind inline,
// meta.link: buildInlineLink's shape), **bold** / *italic* become marks. Each chip is parented to and listed by the
// quote that embeds it (0490's ownership rule). The card renders the body with the textblock editor
// (modules/ArtifactCard); `meta.quote` stays as the fallback for anything still reading it.
// Idempotent: a quote occurrence that already has a body is skipped.
export const id = "0495-quotes-get-a-body";
export const describe = "Each quote gets a text body; its links become editable link chips.";
export const touches = ["modules", "occurrences"];

import { randomUUID } from "node:crypto";
import { compressTextmap, decompressTextmap } from "../utils/textmapCompression.js";
import { parseInline, deriveLinkLabel } from "../services/markdownImporter.js";

const hasBody = (tm) => { try { const d = typeof tm === "string" ? decompressTextmap(tm) : tm; return !!(d && d.type === "doc" && (d.content || []).length); } catch { return false; } };

/** Pure: a quote string -> { textmap, chips: [{ moduleId, occurrenceId, display, url }] }. */
export function quoteBody(text) {
  const chips = [];
  const mint = (label, url) => {
    const c = { moduleId: randomUUID(), occurrenceId: randomUUID(), display: deriveLinkLabel(label, url), url };
    chips.push(c);
    return { occurrenceId: c.occurrenceId, moduleId: c.moduleId };
  };
  const paragraphs = String(text || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const content = paragraphs.map((p) => ({ type: "paragraph", content: parseInline(p, mint) }));
  return { textmap: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] }, chips };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence } = models;
  const G = String(gridId);
  const mods = await Module.find({ gridId: G, kind: "quote" }).lean();
  const byId = new Map(mods.map((m) => [m.id, m]));
  const occs = await Occurrence.find({ gridId: G, moduleId: { $in: mods.map((m) => m.id) } }).lean();
  const todo = occs.filter((o) => !hasBody(o.textmap) && (byId.get(o.moduleId)?.meta?.quote || "").trim());
  let chipCount = 0;
  const plans = todo.map((o) => { const b = quoteBody(byId.get(o.moduleId).meta.quote); chipCount += b.chips.length; return { o, ...b }; });
  log(`  ${mods.length} quote modules · ${occs.length} placements · ${plans.length} get a body · ${chipCount} link chips`);
  if (dryRun) return { quotes: plans.length, chips: chipCount };

  for (const { o, textmap, chips } of plans) {
    const userId = String(o.userId || "");
    if (chips.length) {
      await Module.insertMany(chips.map((c) => ({ id: c.moduleId, userId, gridId: G, role: "textblock", kind: "inline", label: c.display, fieldBindings: [], meta: { link: { kind: "url", url: c.url } } })));
      await Occurrence.insertMany(chips.map((c) => ({ id: c.occurrenceId, userId, gridId: G, moduleId: c.moduleId, parentId: o.id, occurrences: [], fields: {},
        meta: { link: { kind: "url", url: c.url } }, textmap: compressTextmap({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: c.display }] }] }) })));
    }
    await Occurrence.updateOne({ gridId: G, id: o.id }, {
      $set: { textmap: compressTextmap(textmap), updatedAt: new Date() },
      ...(chips.length ? { $addToSet: { occurrences: { $each: chips.map((c) => c.occurrenceId) } } } : {}),
    });
  }
  return { quotes: plans.length, chips: chipCount };
}
