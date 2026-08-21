/**
 * 0178 — four rows whose `parentId` names a container that does NOT list them.
 *
 * ── FOUND WHILE BUILDING THE END-OF-DAY MOVE, AND IT BLOCKS IT ────────────────────────────────
 *
 * The end-of-day feature moves a ticked task into `Tasks › Completed`. A move is
 * `LINK_OCCURRENCE_TO_PARENT`, which emits ONE `UPDATE_ITEM_PARENT` effect, and the applier
 * (`bindSocketToStore.js:938`) unlists the row **from `occ.parentId`** before re-listing it under
 * the destination:
 *
 *     const fromParentId = occ.parentId;
 *     if (fromParentId && fromParentId !== effect.toParentId) …unlist from fromParentId…
 *
 * So when `parentId` names a container that does not actually list the row, the unlist is a NO-OP
 * against the wrong container and the real lister keeps it. **The row would appear in BOTH its old
 * home and Completed** — a visible duplicate, on live data, on the first end-of-day run.
 *
 * Fixing the APPLIER instead — unlist from every lister — was considered and rejected: this grid
 * multi-parents deliberately (a task lives in its Tasks container AND in each day's `Todo`; the
 * Schedule shares one slot across day columns), so a blanket unlist would tear a task out of the
 * schedule every time it moved. **Multi-parenting is load-bearing; the contradiction is not.**
 *
 * ── THE INVARIANT, STATED STRUCTURALLY ───────────────────────────────────────────────────────
 *
 *     an occurrence's `parentId` must name ONE OF the occurrences that list it.
 *
 * Being listed by several is fine and intended. Being listed by nobody is a different rule
 * (`gridIntegrity` already has it). A null `parentId` is BENIGN and common — 78 listed containers
 * on this grid carry one, because a page listed by a panel has no parent occurrence — so a null is
 * never touched.
 *
 * ── THE SELECTOR WAS CHECKED AGAINST A NAMED EXPECTATION, WHICH IS WHY IT DECLINES ONE ───────
 *
 * Five rows on poms grid contradict. Four are the same shape and one is NOT, and a rule that
 * repaired all five would corrupt the fifth:
 *
 *     Peer Support Group    parentId=Occupational  listedBy=[Emotional]                REPAIR
 *     Talk to Angela        parentId=Occupational  listedBy=[Emotional, Todo, Todo]    REPAIR
 *     Psych appointment     parentId=Occupational  listedBy=[Emotional]                REPAIR
 *     Therapy with Keith    parentId=Occupational  listedBy=[Emotional]                REPAIR
 *     Emotions Wheel        parentId=Day Page      listedBy=[14 day columns]           DECLINE
 *
 * The Emotions Wheel is the ONE shared wheel multi-parented into every day column on purpose
 * (2026-08-11) — its `parentId` names the BOARD, which is its home, and picking one of fourteen day
 * columns would be inventing an answer to the exact `buildParentMap` last-writer-wins ambiguity
 * that entry records.
 *
 * **The discriminator is structural, never a name and never a count: the destination must be a
 * SIBLING of the stale parent** — i.e. something listed by an occurrence that also lists the stale
 * parent. That is what "the row was dragged from one container to another under the same page, and
 * only the listing side of the move landed" looks like in the data. The four Tasks rows moved
 * Occupational → Emotional, two containers listed by the same `Tasks` page. The wheel's listers are
 * day COLUMNS, which are children of the Day Page board rather than siblings of it, so it declines
 * for its own reason rather than by being special-cased.
 *
 * Ambiguity fails CLOSED: if several listers qualify as siblings, the row is reported and left.
 *
 * NOTHING MOVES ON SCREEN. The renderer reads `occurrences[]`, and not one `occurrences[]` array is
 * touched — only the stale back-pointer. A grid that looks right before looks identical after.
 *
 * REPORTED, NOT FIXED: `test grid 1` carries 2 rows of the same shape. It is the frozen archive
 * (2026-07-31 (4)) and migrations target poms grid; mutating an archive to quiet a checker is the
 * wrong trade.
 */
export const id = "0178-parentid-agrees-with-the-lister";
export const describe =
  "Repoint `parentId` on rows whose parent does not list them, to the sibling container that does. " +
  "Deletes nothing and moves nothing on screen — no `occurrences[]` array is written.";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;

  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const occById = new Map(occs.map((o) => [o.id, o]));
  const lbl = (o) => o?.label || modById.get(o?.moduleId)?.label || "(none)";

  // child -> every occurrence whose `occurrences[]` names it. A Set, because a
  // parent listing the same child twice must not read as two listers.
  const listersOf = new Map();
  for (const o of occs) {
    for (const cid of o.occurrences || []) {
      if (!listersOf.has(cid)) listersOf.set(cid, new Set());
      listersOf.get(cid).add(o.id);
    }
  }
  const listersFor = (id) => [...(listersOf.get(id) || [])];

  const repairs = [];
  const declined = [];

  for (const o of occs) {
    if (!o.parentId) continue;                       // benign: a page listed by a panel
    if (!occById.has(o.parentId)) continue;          // dangling parent — a different rule
    const listers = listersFor(o.id);
    if (listers.length === 0) continue;              // unlisted — gridIntegrity's own rule
    if (listers.includes(o.parentId)) continue;      // agrees with a lister — correct

    // Siblings of the stale parent: listed by something that also lists the stale parent.
    const staleGrandparents = new Set(listersFor(o.parentId));
    const siblings = listers.filter((l) =>
      listersFor(l).some((g) => staleGrandparents.has(g)),
    );

    const desc =
      `${lbl(o)} (${o.id}) parentId=${lbl(occById.get(o.parentId))} ` +
      `listedBy=[${listers.map((x) => lbl(occById.get(x))).join(", ")}]`;

    if (siblings.length === 1) repairs.push({ occ: o, to: siblings[0], desc });
    else declined.push(`${desc} — ${siblings.length === 0 ? "no sibling lister" : `ambiguous (${siblings.length} siblings)`}`);
  }

  log(`  contradictions: ${repairs.length + declined.length} · repairable: ${repairs.length} · declined: ${declined.length}`);
  for (const r of repairs) log(`    REPAIR  ${r.desc} -> ${lbl(occById.get(r.to))}`);
  for (const d of declined) log(`    DECLINE ${d}`);

  if (!repairs.length) { log("  nothing to do"); return; }
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  for (const r of repairs) {
    await Occurrence.updateOne({ id: r.occ.id, gridId }, { $set: { parentId: r.to } });
  }
  log(`  repaired ${repairs.length} — RESTART pm2 so the warm cache re-reads them.`);
}
