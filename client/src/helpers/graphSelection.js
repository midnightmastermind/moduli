// helpers/graphSelection.js
// ============================================================================
// WHICH SLICES ARE LIT, derived from the data instead of cached beside it.
//
// User, 2026-08-12, on the wheel: "the highlight of the selected should be per
// day, not all of them" — and then, shown that the stored highlight was an
// EXACT DUPLICATE of the day's own field value (measured on poms grid: the same
// 7 ids in `meta.graph.highlight["2026-08-12"]` and in the journal's Mood
// field): *derive it from the field*.
//
// THAT IS WHY THIS FILE EXISTS AND THE CACHE DOES NOT. A cache of a value that
// already lives somewhere else is a second source of truth, and only the paths
// someone remembered to wire keep it in step: clicking the wheel lit it because
// the op wrote both, while dragging a row onto a day, editing the field by hand,
// or any future operation wrote the value and left the wheel dark. Reading the
// field means every one of those lights the wheel for free and the two copies
// can never disagree, because there is only one.
//
// NOTHING HERE KNOWS WHAT A MOOD OR A DAY IS. The graph occurrence names the
// field that holds the selection (`meta.graph.valueFieldId`) and the field that
// dates a row (`meta.graph.dayFieldId`); this walks occurrences and unions.
// ============================================================================

/** A stored date may be a bare `YYYY-MM-DD` or a full ISO stamp. */
function dayOf(value) {
  if (value instanceof Date) {
    const p = (n) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
  }
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : null;
}

/**
 * Every id selected on `day`, unioned across the occurrences dated that day.
 *
 * @param {Iterable<object>} occurrences every occurrence in scope
 * @param {object} opts
 * @param {string} opts.valueFieldId field holding the selected id(s)
 * @param {string} opts.dayFieldId   field holding the row's date
 * @param {string} opts.day          `YYYY-MM-DD`
 * @returns {Set<string>|null} null when it cannot be derived at all, so a caller
 *   can tell "nothing is selected today" (an empty Set) apart from "this graph
 *   is not configured to derive" (null) and fall back rather than blanking.
 */
export function selectedIdsForDay(occurrences, { valueFieldId, dayFieldId, day } = {}) {
  if (!valueFieldId || !dayFieldId || !day) return null;
  const want = dayOf(day);
  if (!want) return null;

  const out = new Set();
  for (const occ of occurrences || []) {
    if (!occ) continue;
    // A FEED COPY CARRIES ITS SOURCE'S FIELD VALUES, so a copy of a dated row
    // living somewhere else would contribute that day's selection to whatever
    // day it was copied under. Every tracker on this grid excludes them for the
    // same reason, and 0064 refuses to write to them at all.
    if (occ.meta?.feedSourceId) continue;
    if (dayOf(occ.fields?.[dayFieldId]?.value) !== want) continue;

    const raw = occ.fields?.[valueFieldId]?.value;
    if (raw == null) continue;
    for (const id of Array.isArray(raw) ? raw : [raw]) {
      if (typeof id === "string" && id) out.add(id);
    }
  }
  return out;
}

/**
 * True when a graph is configured to derive its selection.
 * Kept beside the reader so a caller cannot decide differently.
 */
export function derivesSelection(spec) {
  return !!(spec?.valueFieldId && spec?.dayFieldId);
}
