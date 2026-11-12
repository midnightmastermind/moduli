// 0496 — every item in the organized Lookup lists gets its own annotation quote, right under it in its bullet.
//
// User 2026-11-12: "go through lookup again and put in individual annotations on each item of the organized lists".
// The "Lookup / Catch-All List" holds seven sections (Books / Reading … Misc / Fragments); each is one textblock whose
// bullet list holds one link chip per item, and the section has one summary quote at the end. That summary stays.
// Each bullet now also holds a quote (a moduleEmbed after the chip's paragraph — a listItem takes blocks after its
// paragraph), in the same shape as 0492's quotes + 0495's body: a role:"artifact" kind:"quote" module, an occurrence
// parented to AND listed by the section textblock (0490), a textmap body whose links are link chips owned by the quote.
// Items are matched by chip occurrence id AND by the text the annotation was written for; an item whose text changed
// is skipped and reported. Idempotent: a bullet that already holds an embed is skipped.
export const id = "0496-lookup-item-annotations";
export const describe = "An annotation quote under each item of the organized Lookup lists.";
export const touches = ["modules", "occurrences"];

import { randomUUID } from "node:crypto";
import { compressTextmap, decompressTextmap } from "../utils/textmapCompression.js";
import { annotationText } from "./0492-lookup-annotations.mjs";
import { quoteBody } from "./0495-quotes-get-a-body.mjs";
import { ITEM_ANNOTATIONS } from "./data/0496-lookup-item-annotations.mjs";

const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
const plain = (n) => !n ? "" : n.type === "text" ? n.text : n.type === "hardBreak" ? "\n" : (n.content || []).map(plain).join("");

/** Pure: the section textblock's doc + chip texts -> the new doc and what to mint. `mint(chipId, quote)` returns the
 *  quote occurrence id to embed. Bullets with no annotation row, a changed text, or an existing embed are left alone. */
export function planItemAnnotations(doc, chipTextById, rowsByChip, mint) {
  const added = [], changed = [];
  const content = (doc.content || []).map((block) => {
    if (block.type !== "bulletList") return block;
    return { ...block, content: (block.content || []).map((li) => {
      const chip = (li.content?.[0]?.content || []).find((n) => n.type === "instanceTextblockInline");
      const row = chip && rowsByChip.get(chip.attrs?.occurrenceId);
      if (!row) return li;
      if ((li.content || []).some((n) => n.type === "moduleEmbed")) return li;
      const [chipId, text, note, links] = row;
      if (norm(chipTextById.get(chipId)) !== norm(text)) { changed.push(chipId); return li; }
      const occurrenceId = mint(chipId, annotationText(note, links));
      added.push({ chipId, occurrenceId });
      return { ...li, content: [...li.content, { type: "moduleEmbed", attrs: { occurrenceId, align: "full" } }] };
    }) };
  });
  return { doc: { ...doc, content }, added, changed };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Grid, Module, Occurrence } = models;
  const G = String(gridId);
  const userId = String((await Grid.findById(gridId).select("userId").lean())?.userId || "");
  const catchMods = await Module.find({ gridId: G, label: "Lookup / Catch-All List", role: "container" }).select("id").lean();
  const roots = await Occurrence.find({ gridId: G, moduleId: { $in: catchMods.map((m) => m.id) } }).select("id occurrences").lean();
  if (roots.length !== 1) throw new Error(`0496: expected one "Lookup / Catch-All List", found ${roots.length}`);
  const sections = await Occurrence.find({ gridId: G, id: { $in: roots[0].occurrences } }).select("id occurrences").lean();
  const tbs = await Occurrence.find({ gridId: G, id: { $in: sections.flatMap((s) => s.occurrences || []) } }).lean();
  const rowsByChip = new Map(ITEM_ANNOTATIONS.map((r) => [r[0], r]));
  const chips = await Occurrence.find({ gridId: G, id: { $in: [...rowsByChip.keys()] } }).select("id textmap").lean();
  const chipTextById = new Map(chips.map((c) => { let t = ""; try { t = plain(decompressTextmap(c.textmap)); } catch {} return [c.id, t]; }));

  const plans = [];
  let total = 0, changed = [];
  for (const tb of tbs) {
    let doc; try { doc = decompressTextmap(tb.textmap); } catch { continue; }
    if (!doc?.content?.some((b) => b.type === "bulletList")) continue;
    const quotes = [];
    const r = planItemAnnotations(doc, chipTextById, rowsByChip, (chipId, quote) => {
      const occId = randomUUID(); quotes.push({ chipId, occId, quote, body: quoteBody(quote) }); return occId;
    });
    changed = changed.concat(r.changed);
    if (quotes.length) { plans.push({ tb, doc: r.doc, quotes }); total += quotes.length; }
  }
  const found = new Set(tbs.flatMap((tb) => { try { return JSON.stringify(decompressTextmap(tb.textmap)).match(/"occurrenceId":"[^"]+"/g) || []; } catch { return []; } }).map((s) => s.slice(16, -1)));
  const absent = ITEM_ANNOTATIONS.filter((r) => !found.has(r[0])).map((r) => r[0].slice(0, 8));
  log(`  ${plans.length} lists · ${total} items to annotate · ${changed.length} text changed${changed.length ? ` (${changed.map((c) => c.slice(0, 8)).join(",")})` : ""} · ${absent.length} not found${absent.length ? ` (${absent.join(",")})` : ""}`);
  if (dryRun) { for (const q of plans[0]?.quotes.slice(0, 3) || []) log(`  e.g. ${q.quote.slice(0, 150)}`); return { planned: total }; }

  for (const { tb, doc, quotes } of plans) {
    for (const { chipId, occId, quote, body } of quotes) {
      const modId = randomUUID();
      await Module.create({ id: modId, userId, gridId: G, role: "artifact", kind: "quote", label: quote.replace(/\*\*\[annotation\]\*\* /, "").slice(0, 60),
        fieldBindings: [], meta: { quote, attribution: "", codexAnnotation: "annotation", lookupAnnotation: true, lookupItemOf: chipId } });
      if (body.chips.length) {
        await Module.insertMany(body.chips.map((c) => ({ id: c.moduleId, userId, gridId: G, role: "textblock", kind: "inline", label: c.display, fieldBindings: [], meta: { link: { kind: "url", url: c.url } } })));
        await Occurrence.insertMany(body.chips.map((c) => ({ id: c.occurrenceId, userId, gridId: G, moduleId: c.moduleId, parentId: occId, occurrences: [], fields: {},
          meta: { link: { kind: "url", url: c.url } }, textmap: compressTextmap({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: c.display }] }] }) })));
      }
      await Occurrence.create({ id: occId, userId, gridId: G, moduleId: modId, parentId: tb.id, occurrences: body.chips.map((c) => c.occurrenceId), fields: {}, meta: {},
        textmap: compressTextmap(body.textmap) });
    }
    await Occurrence.updateOne({ gridId: G, id: tb.id }, { $set: { textmap: compressTextmap(doc), updatedAt: new Date() }, $addToSet: { occurrences: { $each: quotes.map((q) => q.occId) } } });
  }
  return { annotated: total };
}
