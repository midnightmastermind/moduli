// 0333 — the link chips that were STORED with their markdown syntax showing.
//
// User, 2026-09-17: *"the *** arent resolving for markdown like they should"* →
// *"the *** was in a minitextblock occurance btw"*. On screen, inside the Alan
// Watts article, a chip reading literally:
//
//     ***The Book: On the Taboo Against Knowing Who You Are***
//
// ── THE CAUSE, and it is one branch order ──────────────────────────────────
//
// `parseInline` tries `[text](url)` FIRST — deliberately, so a link wins over a
// surrounding emphasis run — and then minted the chip with `linkMatch[1]`
// VERBATIM. Every other token in that function (`***x***`, `**x**`, `*x*`,
// `` `x` ``) is parsed into real marks; the inside of a link LABEL was the one
// place the parser never looked.
//
// And a chip cannot carry a mark even if it did: a minted chip is an
// OCCURRENCE whose text is a module LABEL — a plain string — so emphasis inside
// a label has nowhere to go. Stripping it is the only faithful answer, which is
// what `stripInlineMd` already does for container headers. Fixed at the source
// in `markdownImporter.js`; this migration is the half that repairs what is
// ALREADY on the grid, because an importer-only change helps nothing that
// exists (the 2026-09-16 quote-rendering lesson, from the storage side).
//
// ── THE CENSUS, taken before anything was written ──────────────────────────
//
//     inline (link chip) modules on poms grid   1867
//       carrying raw markdown in the label        21
//
//     e.g.  "*Billboard* 200"   "*public library*"
//           "***The Book: On the Taboo Against Knowing Who You Are***"
//
// ── IT IS SCOPED TO CHIPS, AND THAT IS THE SAFETY ──────────────────────────
//
// `kind: "inline"` ONLY. The grid also holds 414 modules whose label carries
// `**…**`, and almost all of them are the codex `**[annotation]**` markers —
// `ANNOTATION_RE` keys on exactly that bold marker (2026-09-16), so stripping
// it would make every annotation read as an ordinary quote. A blanket
// "strip markdown from every label" pass would have destroyed that.
//
// A chip's own LINK is never touched — only the text it prints.

import { stripInlineMd } from "../services/markdownImporter.js";

export const id = "0333-link-chip-labels-carry-raw-markdown";
export const description =
  "Strip leftover markdown emphasis from inline link-chip labels (kind:'inline') minted before the importer stripped it.";
export const touches = ["modules"];

// A label needs repair when stripping changes it. Asking the shared stripper
// rather than re-deriving "does this look like markdown" is what keeps this
// migration and the importer from disagreeing about what a clean label is.
export function planLabelFix(modules) {
  const plan = [];
  for (const m of modules) {
    if (m.kind !== "inline") continue;
    const raw = String(m.label ?? "");
    if (!raw) continue;
    const next = stripInlineMd(raw);
    if (next && next !== raw) plan.push({ id: m.id, _id: m._id, from: raw, to: next });
  }
  return plan;
}

export async function up({ gridId, models, log = console.log, dryRun = true }) {
  const { Module } = models;
  const mods = await Module.find({ gridId: String(gridId), kind: "inline" }).lean();
  const plan = planLabelFix(mods);

  log(`inline link-chip modules: ${mods.length} · carrying raw markdown: ${plan.length}`);
  for (const p of plan) log(`  ${JSON.stringify(p.from)} -> ${JSON.stringify(p.to)}`);
  if (dryRun || !plan.length) return { changed: 0, planned: plan.length };

  for (const p of plan) await Module.updateOne({ _id: p._id }, { $set: { label: p.to } });

  // Read the RESULT back out of the database, not off the log.
  const after = await Module.find({ gridId: String(gridId), kind: "inline" }).lean();
  const left = planLabelFix(after);
  if (left.length) throw new Error(`${left.length} chip label(s) still carry markdown after the write`);
  log(`cleaned ${plan.length} chip label(s); 0 left carrying markdown`);
  return { changed: plan.length };
}
