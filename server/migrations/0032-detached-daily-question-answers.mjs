// Repairs the Daily Question / Daily Answer wreckage left by the build-op
// duplication class (0022 / 0023) and by the create-vs-parent-list write
// asymmetry documented on 2026-07-29 (`create_occurrence` is queued server-side
// and survives a disconnect; the parent-list `update_occurrence` is not — so a
// client that goes away mid-build leaves children that exist but are not listed,
// and children whose parent was later swept).
//
// User 2026-08-01: "i think the daily question accidentally got deleted too."
// It was NOT deleted — audited on the live grid, every day column still holds a
// Daily Question that its Journal lists. What HAD accumulated:
//   * 2 Daily Question wrappers that claim a Journal as parent but are NOT in
//     that Journal's occurrences[] (Jul 30 + Aug 1) — invisible, and they drag
//     an empty answer along each.
//   * 20 Daily Answer textblocks whose parent occurrence no longer exists.
//   * 1 Daily Answer whose parent exists but does not list it.
//
// SAFETY: measured with `decompressTextmap`, NOT a regex over the raw document —
// raw reads store textmap COMPRESSED, so a naive scan reports "no text" for
// everything and would happily delete a journal entry. Verified before writing
// this: 0 of the detached occurrences contain any writing. The guard stays in
// the code anyway — anything with text is logged and KEPT, never dropped.
//
// A detached answer whose parent still exists and lists no answer is RE-LINKED
// rather than deleted; only genuinely empty, genuinely unreachable ones go.

import { decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0032-detached-daily-question-answers";
export const describe =
  "Removes Daily Question wrappers and Daily Answer textblocks that are detached (parent gone, or parent " +
  "exists but does not list them) and contain no writing; re-links a detached answer whose parent still " +
  "wants one. Never deletes anything containing text.";

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence } = models;

  const mods = await Module.find({ gridId, label: { $in: ["Daily Question", "Daily Answer"] } })
    .select({ id: 1, label: 1 }).lean();
  const dqModIds = new Set(mods.filter(m => m.label === "Daily Question").map(m => m.id));
  const daModIds = new Set(mods.filter(m => m.label === "Daily Answer").map(m => m.id));
  if (!dqModIds.size && !daModIds.size) { log("no Daily Question/Answer modules on this grid"); return; }

  const all = await Occurrence.find({ gridId })
    .select({ id: 1, moduleId: 1, parentId: 1, occurrences: 1, textmap: 1 }).lean();
  const byId = new Map(all.map(o => [o.id, o]));

  const textIn = (o) => {
    const tm = decompressTextmap(o?.textmap) || {};
    return (JSON.stringify(tm.content || []).match(/"text":"[^"]+"/g) || []).length;
  };
  const subtreeText = (o, seen = new Set()) => {
    if (!o || seen.has(o.id)) return 0;
    seen.add(o.id);
    let n = textIn(o);
    for (const k of o.occurrences || []) n += subtreeText(byId.get(k), seen);
    return n;
  };
  // Detached = claims a parent, but that parent is gone OR does not list it.
  const detachment = (o) => {
    if (!o.parentId) return null;
    const p = byId.get(o.parentId);
    if (!p) return "parent-gone";
    return (p.occurrences || []).includes(o.id) ? null : "not-listed";
  };

  const drop = new Set();
  let kept = 0, relinked = 0;

  // 1. Detached Daily Question wrappers — take their subtree with them.
  for (const o of all) {
    if (!dqModIds.has(o.moduleId)) continue;
    const why = detachment(o);
    if (!why) continue;
    if (subtreeText(o) > 0) { log(`  KEEPING Daily Question ${o.id.slice(0, 8)} (${why}) — it contains writing`); kept++; continue; }
    drop.add(o.id);
    for (const k of o.occurrences || []) if (byId.has(k)) drop.add(k);
    log(`  Daily Question ${o.id.slice(0, 8)} (${why}, empty) + ${(o.occurrences || []).length} child(ren)`);
  }

  // 2. Detached Daily Answer textblocks.
  for (const o of all) {
    if (!daModIds.has(o.moduleId) || drop.has(o.id)) continue;
    const why = detachment(o);
    if (!why) continue;
    if (textIn(o) > 0) { log(`  KEEPING Daily Answer ${o.id.slice(0, 8)} (${why}) — it contains writing`); kept++; continue; }

    // Parent still there and holding no answer at all? Re-link instead of delete.
    const p = why === "not-listed" ? byId.get(o.parentId) : null;
    const parentHasAnswer = p && (p.occurrences || []).some(k => daModIds.has(byId.get(k)?.moduleId));
    if (p && !parentHasAnswer) {
      relinked++;
      log(`  re-linking Daily Answer ${o.id.slice(0, 8)} into parent ${p.id.slice(0, 8)} (it had none)`);
      if (!dryRun) await Occurrence.updateOne({ gridId, id: p.id }, { $addToSet: { occurrences: o.id } });
      continue;
    }
    drop.add(o.id);
  }

  // 2b. CASCADE to a fixed point. Deleting a wrapper orphans any child that
  //     claimed it as parent but was missing from its occurrences[] — a
  //     second-order orphan the first pass cannot see. Without this the run
  //     leaves debris behind and only converges if you run it twice (observed
  //     on the live grid: 2 answers left over after the first apply).
  for (let pass = 0; pass < 10; pass++) {
    let added = 0;
    for (const o of all) {
      if (drop.has(o.id) || !o.parentId || !drop.has(o.parentId)) continue;
      if (!daModIds.has(o.moduleId) && !dqModIds.has(o.moduleId)) continue;
      if (subtreeText(o) > 0) { log(`  KEEPING ${o.id.slice(0, 8)} — parent is going but it contains writing`); kept++; continue; }
      drop.add(o.id);
      added++;
    }
    if (!added) break;
    log(`  cascade pass ${pass + 1}: +${added} newly-orphaned occurrence(s)`);
  }

  if (!drop.size) {
    log(`nothing detached to remove${kept ? ` (${kept} kept — had text)` : ""}${relinked ? `, ${relinked} re-linked` : ""}`);
    return;
  }

  // 3. Scrub the dropped ids out of any surviving parent's list AND textmap
  //    embeds, so we never leave a dangling child ref behind (the integrity
  //    rule added 2026-07-29).
  let scrubbed = 0;
  for (const o of all) {
    if (drop.has(o.id)) continue;
    const listHits = (o.occurrences || []).filter(k => drop.has(k));
    const tm = decompressTextmap(o.textmap) || {};
    const content = tm.content || [];
    const embedHits = content.filter(n => drop.has(n?.attrs?.occurrenceId));
    if (!listHits.length && !embedHits.length) continue;
    scrubbed++;
    if (!dryRun) {
      const next = content.filter(n => !drop.has(n?.attrs?.occurrenceId));
      const $set = { occurrences: (o.occurrences || []).filter(k => !drop.has(k)) };
      if (embedHits.length) $set.textmap = { type: "doc", content: next.length ? next : [{ type: "paragraph" }] };
      await Occurrence.updateOne({ gridId, id: o.id }, { $set });
    }
  }

  log(`removing ${drop.size} detached occurrence(s); scrubbed refs from ${scrubbed} parent(s)` +
      `${kept ? `; ${kept} kept (had text)` : ""}${relinked ? `; ${relinked} re-linked` : ""}`);
  if (!dryRun) await Occurrence.deleteMany({ gridId, id: { $in: [...drop] } });
}
