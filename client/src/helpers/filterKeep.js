// Search › "Keep filters": is this occurrence on screen under the filters in force?
//
// The same decision the boards make, applied up the chain: a row is kept when it passes its
// container's filter (ModuleContainer: the container's effective filter + the active named
// filter's conditions + the container's own local filters), and every container above it passes
// its parent's the same way, up to the page. A row inside a day column the date hides is hidden,
// however well the row itself matches — so the walk does not stop at the first level.
import { cachedParentMap } from "./dragHitTesting.js";
import { makeEffectiveFilterResolver, getLocalFilterConditions, isOccurrenceVisible } from "../state/selectors.js";

export function makeFilterKeeper({ grid, occurrencesById = {}, modulesById = {} } = {}) {
  const pbc = cachedParentMap(occurrencesById);
  const eff = makeEffectiveFilterResolver({ grid, occurrencesById, parentByChildId: pbc });
  const named = (grid?.namedFilters || []).find((f) => f.id === grid?.activeFilterId) || null;
  const gridConds = named?.conditions || [];
  const roleOf = (occ) => occ?.role || modulesById[occ?.moduleId]?.role || null;
  const memo = new Map();

  const keep = (occId, guard = new Set()) => {
    if (memo.has(occId)) return memo.get(occId);
    const occ = occurrencesById[occId];
    if (!occ) return false;
    if (guard.has(occId)) return true;
    guard.add(occId);
    let ok;
    if (roleOf(occ) === "page") ok = !occ.hidden;           // the walk ends at the page
    else {
      const pid = pbc[occId] ?? occ.parentId;
      const parent = pid ? occurrencesById[pid] : null;
      if (!parent) ok = !occ.hidden;                           // homeless: nothing filters it
      else {
        const prole = roleOf(parent);
        if (prole === "container" || prole === "page") {
          const local = getLocalFilterConditions(parent);
          const conds = gridConds.length || local.length ? [...gridConds, ...local] : null;
          ok = isOccurrenceVisible(occ, eff(parent), conds) && keep(pid, guard);
        } else ok = keep(pid, guard);
      }
    }
    memo.set(occId, ok);
    return ok;
  };
  return (occId) => keep(occId);
}
