// server/migrations/0063-orphan-feed-clones.mjs
//
// Remove the feed copies APPLY_TEMPLATE cloned before `224ce800` taught it not
// to, and give the container they hang off its feed back.
//
// ── WHY THERE IS ANYTHING TO CLEAN ──────────────────────────────────────────
//
// A feed copy is DERIVED data: feedSync mints it from its owner's `feed`
// config, sweeps it, and re-materialises it. Until 2026-08-07 14:10
// APPLY_TEMPLATE cloned those children like any other, and did not carry the
// `feed` key — so a cloned graph came out holding frozen copies of a query
// result, with no query behind it.
//
// That leaves the worst of both worlds, and all three parts are measurable:
//   • the container can never re-materialise or self-heal (no `feed`)
//   • feedSync will never sweep the copies (it only scans under a feed owner)
//   • the clone MINTED a module per copy, where feedSync reuses the source's —
//     which is why poms grid's `inert-kind` warning reads 172 and 128 of those
//     are these.
//
// **THE MECHANISM IS ALREADY FIXED.** Verified by timestamps before writing
// this: every one of the 137 nodes on the affected column was created by
// 2026-08-07T03:15Z, eleven hours BEFORE the fix commit, and none since. This
// migration is residue cleanup, not a workaround for a live bug — the standing
// rule that a recurring bug is a claim about TIMESTAMPS, applied to a defect
// I had briefly mis-reported as ongoing.
//
// ── THE PREDICATE, AND WHY IT IS SAFE ───────────────────────────────────────
//
// An ORPHAN is an occurrence carrying `meta.feedSourceId` whose parent has NO
// `feed`. Nothing else qualifies: a copy under a real feed owner is live data
// feedSync manages, and a hand-placed child carries no `feedSourceId` at all
// (pinned by a feedSync test since July). Measured across all three grids
// before writing: 284 feed copies on poms grid, of which **exactly 128 are
// orphans**, all under one container; 12 on test grid 1 and 0 on test grid 2,
// **none of them orphans**. So the predicate selects the damage and nothing
// else, on live data, today.
//
// The feed is restored from a DONOR — another occurrence carrying the same
// `identitySignature` that does have one (here the Day Page template's own
// wheel). Restoring it is what makes the cleanup faithful rather than
// destructive: the container then materialises its own rows the way a
// post-fix clone would, so this migration lands the column in the state the
// current code produces.
//
// **NO DONOR → THE ORPHANS ARE KEPT AND THE MIGRATION SAYS SO.** Deleting the
// rows and leaving a permanently empty container behind would be a worse
// outcome than the duplication, and guessing a feed config is exactly how a
// migration writes the wrong thing.
//
// A module is deleted only when NO other occurrence uses it — checked per
// module rather than assumed, because a shared module would take a live row
// down with it.

export const id = "0063-orphan-feed-clones";
export const describe =
  "Deletes feed copies that were cloned by APPLY_TEMPLATE before it learned not "
  + "to (their parent has no feed, so feedSync can never sweep them), removes the "
  + "modules those clones minted where nothing else uses them, and restores the "
  + "parent's feed from a same-signature donor so it materialises its own rows.";

/**
 * Split every feed copy into orphans (parent has no `feed`) and live ones.
 * Pure so the predicate — the whole risk — is testable without a database.
 */
export function findOrphanFeedCopies(occurrences) {
  const byId = new Map(occurrences.map((o) => [o.id, o]));
  const parentOf = new Map();
  for (const o of occurrences) {
    for (const c of o.occurrences || []) if (!parentOf.has(c)) parentOf.set(c, o.id);
  }
  const groups = new Map();   // parentId -> { parent, orphans: [] }
  for (const o of occurrences) {
    if (!o?.meta?.feedSourceId) continue;
    const parent = byId.get(parentOf.get(o.id)) || null;
    if (parent?.feed) continue;               // live: feedSync owns it
    const key = parent?.id || "(no parent)";
    if (!groups.has(key)) groups.set(key, { parent, orphans: [] });
    groups.get(key).orphans.push(o);
  }
  return groups;
}

/** Another occurrence with the same identitySignature that DOES carry a feed. */
export function findFeedDonor(occurrences, parent) {
  if (!parent?.identitySignature) return null;
  return occurrences.find(
    (o) => o.id !== parent.id && o.identitySignature === parent.identitySignature && o.feed,
  ) || null;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const occurrences = await Occurrence.find({ gridId }).select("-textmap").lean();
  const groups = findOrphanFeedCopies(occurrences);

  if (!groups.size) { log("  · no orphan feed copies — nothing to clean"); return; }

  let deletedOccs = 0, deletedMods = 0, feedsRestored = 0, keptForNoDonor = 0;

  for (const [, { parent, orphans }] of groups) {
    const where = parent ? `"${parent.label || parent.id}"` : "(no parent)";
    const donor = parent ? findFeedDonor(occurrences, parent) : null;

    // Fail LOUD, keep the data: an empty container with no feed is worse than
    // the duplication this is cleaning up.
    if (!donor) {
      keptForNoDonor += orphans.length;
      log(`  · ${where}: ${orphans.length} orphan(s) KEPT — no same-signature donor carries a feed to restore`);
      continue;
    }

    const ids = orphans.map((o) => o.id);
    // Per module, not per group: a module shared with a live occurrence must
    // survive, or deleting these rows takes something real with them.
    const modIds = [...new Set(orphans.map((o) => o.moduleId).filter(Boolean))];
    const orphanIdSet = new Set(ids);
    const safeMods = modIds.filter(
      (mid) => !occurrences.some((o) => o.moduleId === mid && !orphanIdSet.has(o.id)),
    );
    const sharedMods = modIds.length - safeMods.length;

    log(`  · ${where}: ${ids.length} orphan(s), ${safeMods.length} module(s) to remove`
      + (sharedMods ? ` (${sharedMods} module(s) shared with a live row — KEPT)` : "")
      + ` · restoring feed from "${donor.label || donor.id}"`);

    if (dryRun) { deletedOccs += ids.length; deletedMods += safeMods.length; feedsRestored += 1; continue; }

    await Occurrence.deleteMany({ gridId, id: { $in: ids } });
    if (safeMods.length) await Module.deleteMany({ gridId, id: { $in: safeMods } });
    // Unlink from the parent's child list AND restore the feed in one write.
    await Occurrence.updateOne(
      { gridId, id: parent.id },
      { $set: { feed: donor.feed, occurrences: (parent.occurrences || []).filter((c) => !orphanIdSet.has(c)) } },
    );
    deletedOccs += ids.length; deletedMods += safeMods.length; feedsRestored += 1;
  }

  log(`  ${dryRun ? "[dry run] would delete" : "deleted"} ${deletedOccs} occurrence(s) and ${deletedMods} module(s)`
    + `, ${dryRun ? "restore" : "restored"} ${feedsRestored} feed(s)`
    + (keptForNoDonor ? ` · ${keptForNoDonor} kept for lack of a donor` : ""));
}
