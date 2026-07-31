// User, 2026-07-31: "the daypage for yesterday added all the sections twice".
//
// ROOT CAUSE — the day columns predate their own identity markers.
// `APPLY_TEMPLATE mode:"merge"` decides "this section already exists" by
// matching `identitySignature`. Migration 0018 converted the old per-day PAGES
// into columns and kept their sections as-is, so those sections carry NO
// signature. Every merge since then looked for `daypage:Journal`, found
// nothing, and cloned a second Journal beside the user's. Yesterday's column
// ended up with two of all five sections, and its duplicate Daily Question had
// collected TEN empty question wrappers — one per merge.
//
// Today's column was built fresh (signed), which is why only the older columns
// duplicated — and why 07-28, still unsigned, would have duplicated the next
// time it was viewed. Signing every existing section is what actually stops it;
// deleting the clones is just cleanup.
//
// SAFETY: the keeper is whichever copy holds writing, and a copy holding ANY
// text is never deleted — if both sides have content the migration keeps both
// and says so, because a duplicate section is a nuisance and a deleted journal
// entry is not. Todo is skipped entirely: it is the SCHEDULE's own container
// multi-parented in (its parentId points at the schedule day-col, and it
// carries `slot:Todo`), so re-signing or removing it would reach into the
// user's schedule.

import { decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0022-day-column-section-signatures";
export const describe =
  "Stamps identitySignature on day-column sections that never had one (the pre-0018 page conversions) so " +
  "APPLY_TEMPLATE's merge stops cloning a second copy of every section, and removes the empty duplicates it " +
  "already made. Never deletes a section that contains text.";

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence } = models;

  const boardMod = await Module.findOne({ gridId, role: "page", kind: "board", label: "Day Page" })
    .select({ id: 1 }).lean();
  const boardOcc = boardMod
    ? await Occurrence.findOne({ gridId, moduleId: boardMod.id }).select({ id: 1, occurrences: 1 }).lean()
    : null;
  if (!boardOcc) { log("no Day Page board on this grid"); return; }

  /** Every occurrence id under `rootId`, following occurrences[] only. */
  const subtree = async (rootId, acc = []) => {
    const o = await Occurrence.findOne({ gridId, id: rootId }).select({ id: 1, occurrences: 1, textmap: 1 }).lean();
    if (!o) return acc;
    acc.push(o);
    for (const k of o.occurrences || []) await subtree(k, acc);
    return acc;
  };
  /** How much writing lives in this subtree — the delete guard AND the keeper test. */
  const textNodesIn = (nodes) =>
    nodes.reduce((n, o) => {
      const tm = decompressTextmap(o.textmap) || {};
      return n + ((JSON.stringify(tm.content || []).match(/"text":"[^"]*"/g) || []).length);
    }, 0);

  let signed = 0, removed = 0, keptBoth = 0;

  for (const colId of boardOcc.occurrences || []) {
    const col = await Occurrence.findOne({ gridId, id: colId }).select({ id: 1, moduleId: 1, occurrences: 1, textmap: 1 }).lean();
    if (!col) continue;
    const colMod = await Module.findOne({ gridId, id: col.moduleId }).select({ label: 1 }).lean();

    // Resolve the column's direct children, skipping anything multi-parented in
    // from elsewhere (Todo) — those belong to another page.
    const kids = [];
    for (const kid of col.occurrences || []) {
      const o = await Occurrence.findOne({ gridId, id: kid })
        .select({ id: 1, moduleId: 1, parentId: 1, identitySignature: 1 }).lean();
      if (!o || o.parentId !== col.id) continue;
      const m = await Module.findOne({ gridId, id: o.moduleId }).select({ label: 1, role: 1 }).lean();
      if (m?.role !== "container") continue;
      kids.push({ occ: o, label: m.label });
    }

    const byLabel = new Map();
    for (const k of kids) byLabel.set(k.label, [...(byLabel.get(k.label) || []), k]);

    const drop = [];
    for (const [label, group] of byLabel) {
      const scored = [];
      for (const g of group) {
        const nodes = await subtree(g.occ.id);
        scored.push({ ...g, text: textNodesIn(nodes), nodes });
      }
      // Keeper: most writing; tie → the one that was here first (unsigned).
      scored.sort((a, b) => b.text - a.text || (a.occ.identitySignature ? 1 : -1));
      const [keep, ...rest] = scored;

      if (rest.length) {
        const withText = rest.filter(r => r.text > 0);
        if (withText.length) {
          log(`  ${colMod?.label} › ${label}: ${withText.length} duplicate(s) CONTAIN TEXT — keeping all, resolve by hand`);
          keptBoth += withText.length;
        }
        for (const r of rest.filter(r => r.text === 0)) {
          log(`  ${colMod?.label} › ${label}: removing empty duplicate (${r.nodes.length} occ)`);
          removed++;
          drop.push(...r.nodes.map(n => n.id));
        }
      }

      const sig = `daypage:${label}`;
      if (keep.occ.identitySignature !== sig) {
        log(`  ${colMod?.label} › ${label}: identitySignature → ${sig}`);
        signed++;
        if (!dryRun) await Occurrence.updateOne({ gridId, id: keep.occ.id }, { $set: { identitySignature: sig } });
      }
    }

    if (drop.length && !dryRun) {
      const tm = decompressTextmap(col.textmap) || {};
      const content = (tm.content || []).filter(n => !drop.includes(n?.attrs?.occurrenceId));
      await Occurrence.updateOne({ gridId, id: col.id }, {
        $set: {
          occurrences: (col.occurrences || []).filter(k => !drop.includes(k)),
          textmap: { type: "doc", content: content.length ? content : [{ type: "paragraph" }] },
        },
      });
      await Occurrence.deleteMany({ gridId, id: { $in: drop } });
    }
  }

  log(`${signed} section(s) signed, ${removed} empty duplicate(s) removed${keptBoth ? `, ${keptBoth} left for manual review` : ""}`);
}
