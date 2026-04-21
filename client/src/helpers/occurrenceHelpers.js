// Shared occurrence tree utilities

/** Build { childOccId → parentOccId } from all occ.occurrences[] arrays.
 *  Use this instead of walking parentId — parentId is unreliable when a parent
 *  is a folder or when the hierarchy is deeper than one level. */
export function buildReverseMap(occurrences) {
  const map = {};
  for (const occ of occurrences) {
    for (const childId of (occ.occurrences || [])) {
      map[childId] = occ.id;
    }
  }
  return map;
}

const MAX_ANCESTOR_DEPTH = 8;

/** Walk up reverseMap until finding an occ whose id is in gridOccSet (= panel level). */
export function findGridPanelOcc(startOcc, reverseMap, occById, gridOccSet) {
  if (!startOcc) return null;
  let curId = reverseMap[startOcc.id];
  for (let i = 0; i < MAX_ANCESTOR_DEPTH; i++) {
    if (!curId) return null;
    const cur = occById[curId];
    if (!cur) return null;
    if (gridOccSet.has(cur.id)) return cur;
    curId = reverseMap[curId];
  }
  return null;
}
