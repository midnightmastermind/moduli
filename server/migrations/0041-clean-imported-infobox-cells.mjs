// server/migrations/0041-clean-imported-infobox-cells.mjs
//
// User, looking at the Eminem page: *"can you see why eminem's spouses section in
// the infoblock for that page created an empty spot before kimberly. its just a
// comma"*. It reads:
//
//     , Kimberly Anne Scott ​ ​(m. 1999; div. 2001)​ , ​ ​(m. 2006; div. 2006)​
//
// Wikipedia's {{marriage}} template emits EMPTY <li>s purely as anchors for
// TemplateStyles (`<ul><li><link rel="mw-deduplicated-inline-style"></li></ul>`),
// and the importer appended ", " to every <li> — so each empty one landed a bare
// comma where a name should be. The template's zero-width spacing characters came
// through too; they are invisible but are NOT whitespace, so they survived every
// `\s+` collapse and render as unexplained gaps.
//
// `extractInfobox` no longer does either (2026-08-06), but that only fixes FUTURE
// imports. This repairs what is already on the page. It rewrites only the text of
// affected cells; the table, its columns and every other cell are untouched.
//
// Scope, measured before writing: ONE cell across all three grids.
export const id = "0041-clean-imported-infobox-cells";
export const describe =
  "Clean imported infobox table cells that carry a stray leading/doubled comma or the template's " +
  "zero-width spacing characters (Eminem's Spouses row).";

const ZERO_WIDTH = /[​-‍﻿]/g;

/**
 * Pure: the same normalisation extractInfobox now applies, for text that was
 * imported before it did. Returns the cleaned string (unchanged if it was fine).
 * Exported for tests.
 */
export function cleanCellText(text) {
  if (typeof text !== "string") return text;
  return text
    .replace(ZERO_WIDTH, "")
    .replace(/\s+/g, " ")
    .replace(/,\s*,/g, ", ")
    .replace(/\(\s+/g, "(")
    .replace(/^[,·]\s*/, "")
    .replace(/[,·]\s*$/g, "")
    .trim();
}

/** Pure: walk a TipTap cell doc and clean every text node. Returns {doc, changed}. */
export function cleanCellDoc(doc) {
  if (!doc || typeof doc !== "object") return { doc, changed: false };
  let changed = false;
  const walk = (node) => {
    if (!node || typeof node !== "object") return node;
    if (node.type === "text" && typeof node.text === "string") {
      const next = cleanCellText(node.text);
      if (next !== node.text) { changed = true; return { ...node, text: next }; }
      return node;
    }
    if (Array.isArray(node.content)) {
      const content = node.content.map(walk);
      return { ...node, content };
    }
    return node;
  };
  const out = walk(doc);
  return { doc: out, changed };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence } = models;

  // Any container holding a table — imported infoboxes are `kind:"table"`, but the
  // shape is what matters, not how it got here.
  const occs = await Occurrence.find({ gridId, "meta.table.cells": { $exists: true } }).lean();
  log(`${occs.length} occurrence(s) carry a table`);

  let touched = 0;
  for (const occ of occs) {
    const cells = occ.meta?.table?.cells || {};
    const nextCells = {};
    let occChanged = false;
    for (const [key, doc] of Object.entries(cells)) {
      const { doc: cleaned, changed } = cleanCellDoc(doc);
      nextCells[key] = cleaned;
      if (changed) {
        occChanged = true;
        const before = JSON.stringify(doc).slice(0, 90);
        const after = JSON.stringify(cleaned).slice(0, 90);
        log(`  ${occ.id.slice(0, 8)} cell ${key}`);
        log(`     before: ${before}`);
        log(`     after:  ${after}`);
      }
    }
    if (!occChanged) continue;
    touched += 1;
    if (!dryRun) {
      await Occurrence.updateOne({ gridId, id: occ.id }, { $set: { "meta.table.cells": nextCells } });
    }
  }

  log(touched ? `${touched} occurrence(s) rewritten` : "nothing to clean");
  log(dryRun ? "(dry run — no writes)" : "done");
}
