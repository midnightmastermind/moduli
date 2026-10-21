// helpers/sharedModule.js — does a module have placements besides this one?
//
// A copy is another occurrence of the same module (2026-10-21), so a module can
// be placed many times: a board's rows, a template's items and every day's copy
// of them. A RENAME of one placement must then go on that occurrence's own
// label — writing the module's label would rename every copy and the template
// (user: "we can change the label on occurances without affecting the original
// model"). A module placed once is renamed itself, as before.
//
// App registers the store's occurrences once; the index is rebuilt only when
// that array changes identity (every store write swaps it).
let getOccurrences = null;
let cache = { list: null, byModule: null };

export function setOccurrencesGetter(fn) { getOccurrences = fn; cache = { list: null, byModule: null }; }

/** Occurrence ids placing each module, from a list of occurrences. Pure. */
export function placementsByModule(occurrences) {
  const byModule = new Map();
  for (const o of occurrences || []) {
    if (!o?.moduleId || o.trashed) continue;
    let ids = byModule.get(o.moduleId);
    if (!ids) byModule.set(o.moduleId, (ids = []));
    ids.push(o.id);
  }
  return byModule;
}

function index(occurrences) {
  const list = occurrences ?? getOccurrences?.() ?? null;
  const arr = Array.isArray(list) ? list : list ? Object.values(list) : [];
  if (cache.list !== list || !cache.byModule) cache = { list, byModule: placementsByModule(arr) };
  return cache.byModule;
}

/** True when some occurrence other than `occurrenceId` places `moduleId`. */
export function hasOtherPlacements(moduleId, occurrenceId, occurrences) {
  if (!moduleId) return false;
  const ids = index(occurrences).get(moduleId) || [];
  return ids.some((id) => id !== occurrenceId);
}

/**
 * Where a rename of this placement goes: "occurrence" when the module is shared
 * and we know which placement was renamed, else "module".
 */
export function renameTarget({ module, occurrence, occurrences } = {}) {
  if (occurrence?.id && module?.id && hasOtherPlacements(module.id, occurrence.id, occurrences)) return "occurrence";
  return "module";
}
