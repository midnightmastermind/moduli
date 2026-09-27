// helpers/activePeriod.js
//
// WHICH value in an effective filter is "the active date".
//
// `$activeDate` / `$activePeriod` / `$activePeriodDates` are read by every
// date-dependent operation on the grid, and the executor picked them with
// `Object.values(efv).find(isDateShaped)` — the FIRST date-shaped value in
// insertion order, whatever field it belonged to.
//
// THE DEFECT THAT EXPOSED IT. `grid.activeFilterValues` is keyed by field id and
// NOTHING PRUNES IT: when a grid's named filter is re-pointed at a different
// date field, the abandoned field's last value stays behind. On the rebuild grid
// (2026-09-27) the Daily filter was moved from `Logged On` to `Date`, and:
//
//     activeFilterValues  Logged On = 2026-09-21   Date = 2026-09-27
//     the toolbar navigates            Date
//     $activeDate resolved to          2026-09-21   <- the abandoned field
//
// So every operation on that grid computed against a date the user could not
// see or change. Measured across every grid, exactly ONE differs — the one whose
// filter field moved — so preferring the active filter's own field changes
// nothing anywhere else. That equality is the control test.
//
// The fix is to ASK THE FILTER which field it navigates instead of guessing by
// shape. Shape is still the fallback, because a grid may carry no named filter
// at all (4 of 10 do not) and an ancestor `filterOverride` may key a date the
// filter's conditions never mention.

const isDateStr = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);

/** Is this effective-filter value a date or a date range? */
export function isDateShaped(v) {
  if (isDateStr(v)) return true;
  return !!v && typeof v === "object" && isDateStr(v.value);
}

/** The field ids the grid's ACTIVE named filter navigates on. Empty when the
 *  grid has no active filter, or the filter declares no conditions. */
export function navFieldIds(grid) {
  const active = (grid?.namedFilters || []).find((f) => f && f.id === grid?.activeFilterId);
  if (!active) return [];
  const out = [];
  for (const c of active.conditions || []) {
    if (c?.fieldId && !out.includes(c.fieldId)) out.push(c.fieldId);
  }
  // A filter may also name its date field directly.
  if (active.primaryDateFieldId && !out.includes(active.primaryDateFieldId)) {
    out.unshift(active.primaryDateFieldId);
  }
  return out;
}

/**
 * Pick the active period value out of an effective filter map.
 *
 * Preference order:
 *   1. a date-shaped value keyed by a field the ACTIVE named filter navigates
 *      (`primaryDateFieldId` first, then condition order — the filter's own
 *      statement of which date it means)
 *   2. the first date-shaped value in the map (the previous behaviour, and the
 *      only answer available on a grid with no named filter)
 *
 * Returns undefined when the map holds no date at all, exactly as before, so
 * "no date filter" stays distinguishable from "a date of null".
 */
export function pickActivePeriod(efv, grid) {
  if (!efv) return undefined;
  for (const fid of navFieldIds(grid)) {
    if (isDateShaped(efv[fid])) return efv[fid];
  }
  return Object.values(efv).find(isDateShaped);
}

/** Every field id ANY named filter on this grid references — not just the active
 *  one. A grid can carry several named filters, and switching between them has to
 *  keep each one's value, so "the active filter does not name it" is the wrong
 *  question for pruning. */
export function filterFieldIds(grid) {
  const out = new Set();
  for (const f of grid?.namedFilters || []) {
    for (const c of f?.conditions || []) if (c?.fieldId) out.add(c.fieldId);
    if (f?.primaryDateFieldId) out.add(f.primaryDateFieldId);
  }
  return out;
}

/**
 * Drop `activeFilterValues` entries that no named filter references.
 *
 * WHY THIS EXISTS. Nothing pruned the map: `Toolbar.handleToolbarNav` spreads the
 * whole thing and sets only the nav fields, so re-pointing a filter at a
 * different date field left the abandoned field's last value behind forever. On
 * the rebuild grid that stale value then WON `$activeDate` (see pickActivePeriod
 * above), and every date-dependent operation computed against a date the user
 * could not see. `pickActivePeriod` makes it harmless; this stops it accruing.
 *
 * FAILS CLOSED: a grid with no named filters prunes NOTHING. An empty reference
 * set would otherwise wipe every value, and "no filters declared" is a normal
 * state, not permission to delete data.
 *
 * Returns the SAME object when there is nothing to drop, so a caller can use
 * identity to skip a write.
 */
export function pruneOrphanFilterValues(values, grid) {
  if (!values) return values;
  const keep = filterFieldIds(grid);
  if (keep.size === 0) return values;
  const orphans = Object.keys(values).filter((k) => !keep.has(k));
  if (orphans.length === 0) return values;
  const out = {};
  for (const [k, v] of Object.entries(values)) if (keep.has(k)) out[k] = v;
  return out;
}
