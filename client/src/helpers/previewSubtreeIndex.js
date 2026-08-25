// helpers/previewSubtreeIndex.js
//
// ONE occurrence index per folder page, shared by every preview card on it.
//
// ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────
// `PagePreviewBody` collected its subtree with a fixpoint SCAN OVER THE WHOLE
// GRID, repeated until nothing new was added:
//
//     let changed = true;
//     while (changed) {
//       changed = false;
//       for (const occ of allOccurrences) {           // <- every occurrence
//         if (occ.parentId && seen.has(occ.parentId)) { seen.add(occ.id); changed = true; }
//       }
//     }
//
// That is O(all occurrences x tree depth) — **per card** — plus a
// `buildLookup` over the same array, also per card. Its own comment names the
// grid it was written against: *"the 720-occurrence parent grid"*. After the
// media import that grid holds **19,966**, so a folder page of fourteen cards
// re-walked ~280,000 rows every time the state object changed, and the root
// folder page stopped filling in part-way down — the user: *"i navigate to the
// root folder and it gets to loading daypages folder preview and stops."*
//
// ── WHAT REPLACES IT: A REVERSE INDEX, BUILT ONCE ───────────────────────────
// The fixpoint is computing one thing — the transitive closure of "parented
// under something already seen". A `parentId -> children` index answers that
// directly, so the walk costs the size of the SUBTREE rather than the size of
// the grid, and the index is built once for the whole page instead of once per
// card.
//
// ── WHY A WeakMap ON THE ARRAY, AND WHY THAT IS THE INVALIDATION ────────────
// The reducer returns a NEW `occurrences` array on every write, so the array's
// identity IS the version. A new array cannot hit a stale entry, and an entry
// cannot outlive the array it describes. This is the same keying
// `cachedParentMap` and the options-resolver collection cache already use, and
// it is deliberately NOT a derived scalar: keying on `length` would serve a
// stale index to anything that re-parents a row without changing the count,
// which is exactly the invalidation test `optionsResolver` was fixed for.
//
// The index is READ-ONLY to callers. Nothing may mutate the returned sets —
// they are shared by every card on the page.

let _indexCache = new WeakMap();

/**
 * Build (or reuse) the reverse indexes for an occurrences array.
 *
 * @param {Array} allOccurrences the store's occurrences array
 * @returns {{ byId: Object, childIdsByParentId: Map<string, string[]> }}
 *   `byId` — id -> occurrence (same shape `buildLookup` produced)
 *   `childIdsByParentId` — parentId -> child ids. The key may be an
 *   OCCURRENCE id or a FOLDER id; a folder is not an occurrence, which is why
 *   folder-page cards need this map at all (see ModulePage's folderChildOccs).
 */
export function occurrenceIndexFor(allOccurrences) {
  if (!Array.isArray(allOccurrences)) {
    return { byId: Object.create(null), childIdsByParentId: new Map() };
  }
  const hit = _indexCache.get(allOccurrences);
  if (hit) return hit;

  const byId = Object.create(null);
  const childIdsByParentId = new Map();
  for (const occ of allOccurrences) {
    if (!occ?.id) continue;
    byId[occ.id] = occ;
    const pid = occ.parentId;
    if (!pid) continue;
    const list = childIdsByParentId.get(pid);
    if (list) list.push(occ.id);
    else childIdsByParentId.set(pid, [occ.id]);
  }

  const entry = { byId, childIdsByParentId };
  _indexCache.set(allOccurrences, entry);
  return entry;
}

/**
 * Every occurrence id reachable from `rootOccurrenceId`, by the two STRUCTURAL
 * paths: a parent's `occurrences[]` list, and the `parentId` back-reference.
 *
 * ── THE TWO EDGES ARE WALKED IN SEPARATE PHASES, AND THAT IS DELIBERATE ─────
 * The obvious shape — one worklist expanding both edges from every node — is
 * NOT what the previous code computed, and measuring caught it before it
 * shipped. The old walk expanded `occurrences[]` from the ROOT ONLY, then
 * seeded the folder's children, then closed over `parentId`. A folder-seeded
 * page's own `occurrences[]` were never followed. On poms grid's root folder
 * the unified walk returned **1564 ids where the old one returned 1193** — 371
 * extra containers pulled in through folder-seeded pages, i.e. a preview card
 * quietly rendering a third more of the grid. So the phases stay separate: the
 * point of this file is to make the same set cheaper, not to change it.
 *
 * Textmap embeds are the third path and are deliberately NOT handled here —
 * `expandByEmbeds` owns that and only adds ids that RESOLVE, so a dangling
 * embed stays undrawn instead of becoming a phantom the module lookup misses.
 *
 * A folder-page card is seeded with `folderIds`: those occurrences hang off a
 * FOLDER, which is not an occurrence, so no walk from the page could reach
 * them.
 *
 * @param {object} args
 * @param {string} args.rootOccurrenceId
 * @param {{byId, childIdsByParentId}} args.index from `occurrenceIndexFor`
 * @param {string[]} [args.folderIds] folder ids whose direct children seed the walk
 * @returns {Set<string>}
 */
export function collectSubtreeIds({ rootOccurrenceId, index, folderIds = [] }) {
  const { byId, childIdsByParentId } = index;
  const seen = new Set();

  // Phase 1 — down the child LIST from the root.
  const listQueue = rootOccurrenceId ? [rootOccurrenceId] : [];
  for (let i = 0; i < listQueue.length; i++) {
    const id = listQueue[i];
    if (!id || seen.has(id)) continue;
    // Added BEFORE the lookup, matching the previous behaviour: a dangling
    // child ref stays in the set and is dropped later by the occurrence build,
    // rather than truncating the walk at the parent that named it.
    seen.add(id);
    const occ = byId[id];
    if (!occ) continue;
    const listed = Array.isArray(occ.occurrences) ? occ.occurrences : [];
    for (const cid of listed) if (!seen.has(cid)) listQueue.push(cid);
  }

  // Phase 2 — the folder's own contents, which no list can reach.
  for (const fid of folderIds) {
    for (const cid of childIdsByParentId.get(fid) || []) seen.add(cid);
  }

  // Phase 3 — close over `parentId`. This is the fixpoint the old code ran as
  // a repeated full-grid scan; walking the reverse index reaches the identical
  // set in one pass proportional to the subtree.
  const parentQueue = [...seen];
  for (let i = 0; i < parentQueue.length; i++) {
    for (const cid of childIdsByParentId.get(parentQueue[i]) || []) {
      if (!seen.has(cid)) { seen.add(cid); parentQueue.push(cid); }
    }
  }

  return seen;
}

// Test seam only — production never calls this. The WeakMap is keyed on array
// identity, so in production entries are collected with the arrays they
// describe; there is nothing to clear.
export function __resetPreviewIndexCache() {
  _indexCache = new WeakMap();
}
