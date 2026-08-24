// helpers/cloneModuleReuse.js
//
// "One module, many occurrences" — the premise, enforced at the clone site.
//
// User, 2026-08-23: *"shouldnt the module too be one, isnt that what the premise
// of the site is."* It is, and measuring said where it was not:
//
//   singleton modules                    6,834
//     genuinely unique content           3,470   a bookmark's URL lives in its
//                                                module's `fileRef`; an
//                                                unlabelled textblock's text
//                                                lives on its occurrence.
//                                                These SHOULD be 1:1.
//     the same thing minted again          924   across 198 signatures —
//                                                Journal ×24, Notes ×24,
//                                                Tasks Completed ×24,
//                                                Daily Answer ×25, Exercise ×26
//
// The amplifier is APPLY_TEMPLATE: `Day Page: Build` clones the day template into
// a new column every morning, and every clone minted a FRESH module identical to
// yesterday's. That is why `0117` had to bind `Set 4` to thirty Exercise modules
// one at a time instead of once.
//
// ── THE TEMPLATE ITSELF IS NEVER REUSED ────────────────────────────────────
//
// The source is a template node (`meta.templateModule: true`); pointing a clone
// at it would place the template. So the first apply still MINTS — and stamps
// `meta.clonedFromModuleId`. Every later apply of the same template node finds
// that stamp and reuses it. Day 1 mints; days 2..N share.
//
// ── A ROOT WITH ITS OWN LABEL IS NEVER SHARED ──────────────────────────────
//
// `rootLabel` renames the root clone per apply — "Day Page - 2026-08-23" — so
// sharing a root would make every day's column carry the same name. Roots with
// an override keep minting.
//
// BACKWARD COMPATIBLE BY CONSTRUCTION: existing clones carry no stamp, so nothing
// already on a grid is re-pointed. The first apply after this ships mints one
// stamped module and every apply after that reuses it.

/** The stamp that says "this module is an apply of that template node". */
export const CLONE_OF = "clonedFromModuleId";

/**
 * Reuse an earlier clone's module id, or null to mint a fresh one.
 * PURE — the whole decision, so it can be driven without an executor.
 *
 * @param modulesById  every module currently known
 * @param srcModId     the TEMPLATE node's module id
 * @param srcMod       that module
 * @param isRoot       is this the subtree root?
 * @param rootLabelOverride  a per-apply name for the root, if any
 */
export function pickReusableModuleId({ modulesById, srcModId, srcMod, isRoot = false, rootLabelOverride = null } = {}) {
  if (!srcModId || !srcMod) return null;
  // A renamed root is a different thing each time it is applied.
  //
  // HONEST NOTE: A/B'd on both call sites, and removing this line fails NO test —
  // the label comparison below already covers every caller today, because a clone
  // renamed "Day Page - 2026-08-23" no longer matches the source's own label and
  // is therefore never a candidate. It is kept as a second lock and labelled as
  // one: if the label comparison is ever loosened, this is what still stops every
  // day column sharing a name.
  if (isRoot && rootLabelOverride) return null;
  const want = srcMod.label ?? srcMod.name ?? null;
  for (const m of Object.values(modulesById || {})) {
    if (!m || m.id === srcModId) continue;
    if (m.meta?.[CLONE_OF] !== srcModId) continue;
    // The stamp alone is not enough. A clone whose label, role or kind has since
    // been changed is no longer the same thing, and re-pointing new placements
    // at it would silently adopt somebody's edit.
    if ((m.label ?? m.name ?? null) !== want) continue;
    if (m.role !== srcMod.role || m.kind !== srcMod.kind) continue;
    if (m.trashed) continue;
    return m.id;
  }
  return null;
}

/** The meta a freshly minted clone module must carry so the NEXT apply finds it. */
export function stampCloneOrigin(meta, srcModId) {
  return srcModId ? { ...(meta || {}), [CLONE_OF]: srcModId } : { ...(meta || {}) };
}
