// 0492 — each note on the unorganized Lookup board gets an annotation quote underneath it.
//
// User 2026-11-12: "go through my lookup board of textblocks … give a brief quote underneath that says what you think
// the thing is and any links to more information … add **[annotation]** in the front". The notes are the 250
// textblocks 0382 made from the Raindrop "Lookup" list (one search phrase each). The annotations are written in
// data/0492-lookup-annotations.mjs, keyed by the note's index; data/0492-lookup-texts.json holds each index's text when
// they were written, and a note is matched by THAT TEXT, never by position — a reordered board cannot put an
// annotation under the wrong note, and a note that changed since is skipped and reported.
//
// Shape = the importer's quote (markdownImporter.buildArtifactQuote): a role:"artifact" kind:"quote" module with
// meta.quote / codexAnnotation, an occurrence parented to AND listed by the textblock (0490's ownership rule), and a
// moduleEmbed (align full) appended to the textblock's textmap. Idempotent: a textblock already holding a quote with
// meta.lookupAnnotation is skipped.
export const id = "0492-lookup-annotations";
export const describe = "Annotation quotes under each note on the unorganized Lookup board.";
export const touches = ["modules", "occurrences"];

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { compressTextmap, decompressTextmap } from "../utils/textmapCompression.js";
import { ANNOTATIONS } from "./data/0492-lookup-annotations.mjs";

const TEXTS = JSON.parse(readFileSync(new URL("./data/0492-lookup-texts.json", import.meta.url), "utf8"));
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
const plain = (n) => !n ? "" : n.type === "text" ? n.text : n.type === "hardBreak" ? "\n" : (n.content || []).map(plain).join("");

/** `w:Title` / `g:query` / `u:url` -> a markdown link. */
export function linkMarkdown(ref) {
  const [kind, ...rest] = String(ref).split(":");
  const v = rest.join(":");
  if (kind === "w") return `[Wikipedia: ${v}](https://en.wikipedia.org/wiki/${encodeURI(v.replace(/ /g, "_")).replace(/\(/g, "%28").replace(/\)/g, "%29")})`;
  if (kind === "g") return `[Search](https://www.google.com/search?q=${encodeURIComponent(v)})`;
  if (kind === "u") { let host = v; try { host = new URL(v).hostname.replace(/^www\./, ""); } catch {} return `[${host}](${v})`; }
  return "";
}

/** The quote's text: the annotation label, the note, then its links. */
export function annotationText(text, links) {
  const ls = (links || []).map(linkMarkdown).filter(Boolean);
  return `**[annotation]** ${text}${ls.length ? ` — ${ls.join(" · ")}` : ""}`;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Grid, Module, Occurrence } = models;
  const G = String(gridId);
  const grid = await Grid.findById(gridId).select("userId").lean();
  const boards = await Module.find({ gridId: G, label: "Lookup", role: "container" }).select("id").lean();
  const occs = await Occurrence.find({ gridId: G, moduleId: { $in: boards.map((b) => b.id) } }).select("id occurrences").lean();
  const board = occs.sort((a, b) => (b.occurrences || []).length - (a.occurrences || []).length)[0];
  if (!board || (board.occurrences || []).length < 200) throw new Error("0492: the unorganized Lookup board was not found");
  const kids = await Occurrence.find({ gridId: G, id: { $in: board.occurrences } }).lean();
  const byText = new Map();
  for (const k of kids) { let tm = null; try { tm = decompressTextmap(k.textmap); } catch {} byText.set(norm(plain(tm)), { occ: k, tm }); }
  const existing = new Set((await Module.find({ gridId: G, "meta.lookupAnnotation": true }).select("id").lean()).map((m) => m.id));
  const owned = existing.size ? new Set((await Occurrence.find({ gridId: G, moduleId: { $in: [...existing] } }).select("parentId").lean()).map((o) => o.parentId)) : new Set();

  const plan = [], missing = [];
  for (const [idx, text, links] of ANNOTATIONS) {
    const hit = byText.get(norm(TEXTS[idx]));
    if (!hit) { missing.push(idx); continue; }
    if (owned.has(hit.occ.id)) continue;
    plan.push({ tb: hit.occ, tm: hit.tm, quote: annotationText(text, links) });
  }
  log(`  board ${board.id} · ${kids.length} notes · ${plan.length} to annotate · ${owned.size} already · ${missing.length} not found${missing.length ? ` (${missing.join(",")})` : ""}`);
  if (dryRun) { for (const p of plan.slice(0, 3)) log(`  e.g. ${p.quote.slice(0, 140)}`); return { planned: plan.length }; }

  const userId = String(grid?.userId || "");
  for (const p of plan) {
    const modId = randomUUID(), occId = randomUUID();
    await Module.create({ id: modId, userId, gridId: G, role: "artifact", kind: "quote", label: p.quote.replace(/\*\*\[annotation\]\*\* /, "").slice(0, 60),
      fieldBindings: [], meta: { quote: p.quote, attribution: "", codexAnnotation: "annotation", lookupAnnotation: true } });
    await Occurrence.create({ id: occId, userId, gridId: G, moduleId: modId, parentId: p.tb.id, occurrences: [], fields: {}, meta: {} });
    const doc = p.tm && p.tm.type === "doc" ? p.tm : { type: "doc", content: [] };
    const content = [...(doc.content || []), { type: "moduleEmbed", attrs: { occurrenceId: occId, align: "full" } }];
    await Occurrence.updateOne({ gridId: G, id: p.tb.id }, { $set: { textmap: compressTextmap({ ...doc, content }), updatedAt: new Date() }, $addToSet: { occurrences: occId } });
  }
  return { annotated: plan.length };
}
