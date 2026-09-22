// utils/linkRootIntoParent.js
//
// PARENTED IS NOT LISTED, and on this grid that distinction is the difference
// between a page and an invisible one: every renderer walks the PARENT's
// `occurrences[]`, so a child that only carries `parentId` exists in the data
// and appears nowhere. This repo has repaired that class from five directions.
//
// `markdownToModuli` pushes its own root when it persists, but `planReaderShape`
// is a pure planner and does not — so "add this Reader view as a page" would
// have written a complete, correct, unreachable tree.
//
// ATOMIC AND IDEMPOTENT, deliberately. The `$ne` guard means:
//   - calling it after `markdownToModuli` already pushed is a no-op, so one
//     call site can serve both shapes rather than a per-shape special case
//     that drifts the first time a third shape appears;
//   - it is a `$push` rather than a read-modify-write of the whole array, which
//     is the stale-snapshot clobber this repo has paid for on `occurrences[]`
//     more than once.
import Occurrence from "../models/Occurrence.js";

/**
 * List `childId` in `parentId`'s `occurrences[]`.
 * @returns the parent document whenever the child ENDS UP listed — pushed here,
 *          or already pushed by `markdownToModuli` — or null when there is no
 *          such parent. Returning null for "already listed" made both import
 *          handlers skip the cache sync and the broadcast, so a magic-shape
 *          import was invisible until a restart (2026-09-22).
 */
export async function linkRootIntoParent({ parentId, childId, userId }) {
  if (!parentId || !childId) return null;
  const pushed = await Occurrence.findOneAndUpdate(
    { id: parentId, userId, occurrences: { $ne: childId } },
    { $push: { occurrences: childId } },
    { new: true },
  );
  if (pushed) return pushed;
  return Occurrence.findOne({ id: parentId, userId, occurrences: childId });
}
