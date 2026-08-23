// server/utils/strandableChildren.js
//
// "If I delete this row, does anything lose its only home?"
//
// `sweepOrphans` refuses to delete a module-less occurrence that HAS CHILDREN,
// full stop. That refusal is right in spirit and too blunt in practice, and the
// live grid shows why: `Day Page: Build` occasionally mints a day column whose
// module never persists — twice in the week of 2026-08-20 — and each of those
// dead columns LISTS the shared child every healthy day column also lists.
//
// So the sweep refuses forever, the integrity check reports an error forever,
// and the count grows about one a week. **A check that always shows errors is
// one people stop reading**, which costs more than the two rows do.
//
// THE PRECISE QUESTION IS NOT "does it have children" BUT "would deleting it
// STRAND any". A child listed by another parent keeps its home; only a child
// this row alone lists would be cut adrift.
//
// This is deliberately NOT the wider predicate it could be. It does not walk the
// subtree, and it does not reason about whether a stranded child would be
// harmless — `sweepOrphans`' own header records that deleting a subtree because
// its root lost a pointer is what damaged real data in `0035`. Removing exactly
// one row, having proven every child survives elsewhere, cannot repeat that.

/**
 * Children of `occ` that NOTHING ELSE lists — the ones deleting it would strand.
 * @param occ            the occurrence being considered for deletion
 * @param parentsByChild Map<childId, string[] parentIds>  every listing, grid-wide
 * @returns string[] child ids that would be left with no parent
 */
export function strandableChildren(occ, parentsByChild) {
  const kids = Array.isArray(occ?.occurrences) ? occ.occurrences : [];
  const out = [];
  for (const kid of kids) {
    const parents = parentsByChild?.get?.(kid) || [];
    // Another listing means the child keeps a home. Compare by id and allow for
    // this row appearing twice in its own list, which duplicate-child-ref bugs
    // have produced before (`0198`) — two self-listings are still no other home.
    if (!parents.some((p) => p !== occ.id)) out.push(kid);
  }
  return out;
}

/** Build the child -> parents index the check needs, once per sweep. */
export function buildParentsByChild(occurrences) {
  const m = new Map();
  for (const o of occurrences || []) {
    for (const kid of o.occurrences || []) {
      const list = m.get(kid) || [];
      list.push(o.id);
      m.set(kid, list);
    }
  }
  return m;
}
