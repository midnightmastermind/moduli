/**
 * 0194 — the Eminem infobox's empty spot: an imported table cell with a dropped list entry.
 *
 * USER: *"The Eminem infobox renders an empty spot before Kimberly — its just a comma."*
 *
 * ── WHAT IT ACTUALLY SAYS ───────────────────────────────────────────────────────────────────
 *
 * The `Info` table's `Spouses` cell holds:
 *
 *     "Kimberly Anne Scott (m. 1999; div. 2001) , (m. 2006; div. 2006)"
 *
 * Eminem married the same person twice. Wikipedia's infobox states the NAME once and follows it
 * with two parentheticals; the importer kept both parentheticals and the separator between them,
 * and dropped the repeated name — leaving a comma with nothing on one side of it.
 *
 * ── THE PREDICATE IS `) , (`, NOT "a stray comma" ───────────────────────────────────────────
 *
 * A general "space before a comma" repair would be a licence to rewrite prose. `) , (` means
 * something specific and checkable: two parentheticals with a dropped label between them, which is
 * exactly the importer's failure and nothing else. Scanned across every table cell on the grid it
 * matches **1**, and that is the reported cell — measured before the rule was chosen, not after.
 *
 * ── WHERE THE TEXT LIVES, and the probe that got it wrong first ─────────────────────────────
 *
 * Not in `textmap` — the container's textmap is null. Table cell docs live at
 * `occurrence.meta.table.cells["<row>:<col>"]`. The first scan looked at `meta.cells` and reported
 * **0 orphaned separators on the whole grid**, minutes after the offending string had been read by
 * eye. A probe that reports zero is a claim about the probe.
 *
 * ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────────────────────
 *
 * It does not invent the missing name. Wikipedia itself does not repeat it — the second
 * parenthetical belongs to the same person — so the repair is to remove the separator, leaving
 * `… (m. 1999; div. 2001) (m. 2006; div. 2006)`, which is what the source reads. Guessing a name
 * into a biography is the class `0052` refused for phone numbers.
 *
 * The IMPORTER is not changed. One cell on one page is not enough to characterise the failure, and
 * a change to the import path affects every page anyone brings in afterwards.
 */
export const id = "0194-an-orphaned-separator-in-an-imported-table";
export const describe =
  "Repair imported table cells whose text carries `) , (` — a dropped list entry between two parentheticals (1 on poms grid: the Eminem infobox's Spouses row).";

/** Collapse `) , (` to `) (`. Returns the repaired string, or null when there is nothing to do. */
export function repairOrphanedSeparator(text) {
  if (typeof text !== "string") return null;
  const next = text.replace(/\)\s+,\s+\(/g, ") (");
  return next === text ? null : next;
}

/** The concatenated text of a ProseMirror doc node. */
export function cellText(node) {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  return (node.content || []).map(cellText).join("");
}

/** Rewrite the FIRST text node that carries the pattern, leaving the rest of the doc alone. */
export function repairCellDoc(node) {
  if (!node || typeof node !== "object") return false;
  if (node.type === "text") {
    const fixed = repairOrphanedSeparator(node.text);
    if (fixed === null) return false;
    node.text = fixed;
    return true;
  }
  for (const child of node.content || []) if (repairCellDoc(child)) return true;
  return false;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "(?)";

  const edits = [];
  for (const o of occs) {
    const cells = o.meta?.table?.cells;
    if (!cells || typeof cells !== "object") continue;
    const next = JSON.parse(JSON.stringify(cells));
    let touched = 0;
    for (const [key, doc] of Object.entries(next)) {
      const before = cellText(doc);
      if (!repairCellDoc(doc)) continue;
      touched++;
      log(`  ${nameOf(o)} [${key}]`);
      log(`      before: ${JSON.stringify(before)}`);
      log(`      after:  ${JSON.stringify(cellText(doc))}`);
    }
    if (touched) edits.push({ id: o.id, cells: next });
  }
  if (!edits.length) { log("  nothing to do — no table cell carries `) , (`"); return; }
  if (dryRun) { log("  (dry run — nothing written)"); return; }
  for (const e of edits) {
    await Occurrence.updateOne({ id: e.id, gridId }, { $set: { "meta.table.cells": e.cells } });
  }
  log(`  done — ${edits.length} table(s) repaired`);
}
