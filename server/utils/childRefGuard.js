// utils/childRefGuard.js
//
// "Which of these child ids are really unknown?"
//
// A parent's `occurrences[]` is a list of REAL children, and `update_occurrence`
// drops ids that name nothing — the dangling-ref guard, added 2026-07-29 after
// 42 refs survived four repairs because a client kept echoing them back.
//
// IT ASKED THE WARM CACHE, AND THE WARM CACHE CAN BE THE WRONG ONE.
//
// 2026-08-23, from the user's own grid: the Schedule page was written and the
// log said `dropped 1 unknown child id(s)`. The id was today's day column —
// alive, 49 slots, created half an hour earlier. The cache consulted was
// `GRID CACHE READY: null — Occurrences: 42`: the caches are keyed by
// (userId, gridId), the user had just logged out, cleared cookies and
// reconnected, and a write landed while `activeGridId` was not yet the poms
// grid. Every id in that array looked unknown; one was dropped; the page went
// blank and the day's schedule vanished from the screen while sitting intact in
// Mongo.
//
// This is the mirror of the 2026-08-04 phantom: there, an id PRESENT in the
// cache but absent from Mongo laundered a fake child into persistence. Here an
// id ABSENT from the cache but present in Mongo costs a real one. The same
// misplaced trust, failing in both directions.
//
// SO ABSENCE FROM THE CACHE IS A QUESTION, NOT AN ANSWER. Anything the cache
// cannot vouch for is checked against the database before it is dropped.
// Dangling refs are rare, so the query runs on the exception path only — and it
// turns a heuristic into a fact.

/**
 * Split a parent's incoming child ids into keep / verify.
 * PURE. `verify` is what the caller must ask the database about; everything in
 * `keep` is already vouched for.
 *
 * @param {string[]} childIds   the incoming array
 * @param {string}   parentId   the occurrence being written (may list itself)
 * @param {(id:string)=>boolean} inCache
 */
export function partitionChildRefs(childIds, parentId, inCache) {
  const keep = [], verify = [];
  for (const cid of childIds || []) {
    if (cid === parentId || inCache(cid)) keep.push(cid);
    else verify.push(cid);
  }
  return { keep, verify };
}

/**
 * The array to store, once the database has answered.
 *
 * ORDER IS PRESERVED from the incoming array — on a day column the array IS the
 * running order, and rebuilding it from two buckets would leave the schedule
 * rotated (repaired once already, 0137).
 *
 * AND IT DEDUPES. Found 2026-08-23 while looking for something else: today's Day
 * Page column listed `Journal`, `Notes`, `Tasks Completed` and `Highlights`
 * TWICE each — the same occurrence id, not a cloned row, so
 * `duplicate-template-section` fired on a column that had merely been appended
 * to twice. Listing one child twice renders it twice and can never be right,
 * so the write path is the place to make it impossible. First entry wins,
 * because that is the one whose position the running order was built around.
 */
export function resolveChildRefs(childIds, parentId, inCache, existsInDb) {
  const out = [];
  const seen = new Set();
  for (const cid of childIds || []) {
    if (seen.has(cid)) continue;
    if (cid === parentId || inCache(cid) || existsInDb(cid)) { seen.add(cid); out.push(cid); }
  }
  return out;
}
