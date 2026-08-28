/**
 * 0277 — a cloned doc page embedded the TEMPLATE's children, so it rendered nothing.
 *
 * Found by opening the thing. `0275` cloned the Project Page template into
 * `Project: Paul's Clown Website`, every data check passed — right children,
 * right parent, right tokens, right tasks — and the page painted **0
 * containers**. Read back out of Mongo:
 *
 *     "Project: {ProjectName}"   children Kanban(4v_m43IA) Scope(hZG80mJ-)
 *                                embeds   Kanban(4v_m43IA) Scope(hZG80mJ-)   ok
 *     "Project: Via Fluere"      children Kanban(5951c745) Scope(d501a168)
 *                                embeds   Kanban(5951c745) Scope(d501a168)   ok
 *     "Project: Paul's Clown…"   children Kanban(fcfb85e1) Scope(1acf5093)
 *                                embeds   Kanban(4v_m43IA) Scope(hZG80mJ-)   <- THE TEMPLATE'S
 *
 * A `page/doc` renders its TEXTMAP, not its `occurrences[]`. `cloneSubtree`
 * regenerated the child list with fresh ids and carried the textmap over
 * verbatim, so the clone pointed at the source's children.
 *
 * ── THE ROOT CAUSE IS A DRIFTED TWIN, AND IT IS NOT MINE ────────────────────
 * The CLIENT's APPLY_TEMPLATE has done this remap since it was written, with a
 * comment saying why (`remapEmbeddedRefs`, operationActions.js). The SERVER's
 * `cloneSubtree` never had it. So **everything that clones through the server**
 * — the `apply_template`, `clone_subtree_as_template` and `save_over_template`
 * socket handlers, the v1 API route, and every migration that clones — has been
 * producing pages whose embeds name the SOURCE's children. `Via Fluere` is intact
 * only because it was cloned by the CLIENT, long ago.
 *
 * `cloneSubtree` carries the remap now, so nothing cloned from here on needs
 * this repair. This migration fixes what the old path already left behind.
 *
 * ── THE REPAIR IS POSITIONAL, AND SCOPED TO CLONES ──────────────────────────
 * `cloneSubtree` walks `occurrences[]` in order, so a clone's Nth child IS the
 * clone of the template's Nth child. The repair maps them by position and
 * rewrites only embed ids that appear in the TEMPLATE's child list and NOT in
 * the clone's own.
 *
 * IT MUST NOT BE A BLANKET "EMBEDS SOMETHING THAT IS NOT ITS CHILD" SWEEP.
 * 2026-08-23 (2) measured **474 embeds across 233 hosts reachable only through a
 * textmap** — embedding a non-child is a legitimate, common shape on this grid.
 * So the repair fires ONLY on an occurrence carrying `meta.appliedFromTemplateId`
 * pointing at a page that still exists, and REFUSES when the two child lists are
 * different lengths, because then position is not identity.
 */

export const id = "0277-cloned-page-embedded-the-template";
export const describe = "Repoint a cloned page's textmap embeds at its OWN children — server-side clones kept the template's ids, so the page rendered nothing. Rewrites textmaps; deletes nothing.";
export const touches = ["occurrences"];

/** Every `occurrenceId` an embed-style node names, at any depth. */
export function embeddedIds(textmap, out = []) {
  if (Array.isArray(textmap)) { textmap.forEach(n => embeddedIds(n, out)); return out; }
  if (!textmap || typeof textmap !== "object") return out;
  if (textmap.attrs?.occurrenceId) out.push(textmap.attrs.occurrenceId);
  Object.values(textmap).forEach(v => embeddedIds(v, out));
  return out;
}

/**
 * Which clones still embed their template's children, and the id map to fix them.
 * Returns [{ occId, label, remap: Map, stale: [...] }].
 */
export function planEmbedRepair(occurrences, modulesById) {
  const byId = Object.fromEntries(occurrences.map(o => [o.id, o]));
  const plan = [];
  for (const o of occurrences) {
    const tplId = o.meta?.appliedFromTemplateId;
    if (!tplId || !o.textmap) continue;
    const tpl = byId[tplId];
    if (!tpl || tpl.id === o.id) continue;

    const mine = o.occurrences || [];
    const theirs = tpl.occurrences || [];
    // Position is only identity when the two lists correspond one-to-one.
    if (!mine.length || mine.length !== theirs.length) continue;

    const mineSet = new Set(mine);
    const remap = new Map();
    theirs.forEach((srcId, i) => { if (srcId !== mine[i]) remap.set(srcId, mine[i]); });

    const stale = embeddedIds(o.textmap).filter(id => remap.has(id) && !mineSet.has(id));
    if (!stale.length) continue;
    plan.push({
      occId: o.id,
      label: o.label ?? modulesById[o.moduleId]?.label ?? o.id,
      remap, stale: [...new Set(stale)],
    });
  }
  return plan;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const { remapEmbeddedRefs } = await import("../utils/cloneSubtree.js");

  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const modulesById = Object.fromEntries(mods.map(m => [m.id, m]));
  const plan = planEmbedRepair(occs, modulesById);

  const clones = occs.filter(o => o.meta?.appliedFromTemplateId && o.textmap).length;
  log(`  template-applied occurrences carrying a textmap: ${clones} · embedding the TEMPLATE's children: ${plan.length}`);
  if (!plan.length) { log("  every clone embeds its own children — already converged"); return; }
  for (const p of plan) log(`      "${p.label}" (${p.occId}) → ${p.stale.length} stale embed(s): ${p.stale.map(s => s.slice(0, 8)).join(", ")}`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  for (const p of plan) {
    const src = occs.find(o => o.id === p.occId);
    const fixed = remapEmbeddedRefs(src.textmap, p.remap, new Map());
    await Occurrence.updateOne({ gridId, id: p.occId }, { $set: { textmap: fixed } });
  }
  log(`  done — ${plan.length} page(s) now embed their own children`);
}
