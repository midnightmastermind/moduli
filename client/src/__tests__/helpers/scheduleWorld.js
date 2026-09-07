// The world a tracker suite measures against: today is live, and today has a
// schedule column.
//
// THE PROBLEM THIS EXISTS FOR. Four suites inject a row onto today's schedule
// column and assert what the trackers do with it. Both halves of "today" are
// built by the APP on the first load of each day — `Grid: Snap Filter To Today`
// moves every date-carrying page filter forward, and `Schedule: Build Schedule`
// builds the column. The committed fixture therefore only describes the day it
// was exported on, and every one of those suites goes red at midnight and stays
// red until somebody opens the grid.
//
// It has bitten three times in two days, each from a different direction:
//   2026-09-06  the tests asked for the UTC day while `$today` is LOCAL — red
//               for the last five hours of every evening west of UTC.
//   2026-09-07  the date rolled: no column for today existed at all.
//   2026-09-07  and even with a column, EVERY tracker read zero — because a
//               tracker's period is `$goalPeriod`, read off the page's own
//               `filterOverride`, which still named YESTERDAY. A row dated
//               today falls outside a page still filtered to yesterday, so the
//               injection was invisible and thirteen assertions failed
//               identically. *The clock is not the filter.*
//
// **THE HARNESS CONSTRUCTS THE CONDITION IT MEASURES** — the 2026-08-20 (6)
// rule: *any assertion whose premise is "the grid looked like this when it was
// exported" is a coin flip on export timing.* So this reproduces the app's own
// start-of-day state rather than hoping the fixture is fresh, and asserts each
// half landed — a snap that silently matched nothing would put every assertion
// downstream straight back at the mercy of the export clock.
import { expect } from "vitest";
import { normalizeFilterDateValue } from "../../helpers/filterFieldStamp";

/** Local, matching the executor's own `$today`. Never `toISOString()`. */
export const TODAY = normalizeFilterDateValue(new Date());

export const labelOf = (w, o) => o && (o.label || w.modulesById[o.moduleId]?.label);

export function fieldId(w, name) {
  const hits = w.fx.fields.filter((f) => f.name === name);
  expect(hits.length, `field "${name}" is ambiguous or missing (${hits.length})`).toBe(1);
  return hits[0].id;
}

/**
 * Move every date filter to today — grid-level and every page override that
 * carries the date field. This is `Grid: Snap Filter To Today`'s effect, which
 * the app applies on the first load of a new day; a single sweep cannot see its
 * own write, so the suites have to start from the state it produces.
 */
function snapFiltersToToday(w) {
  const dateF = fieldId(w, "Date");
  let snapped = 0;
  const grid = w.fx.grid;
  if (grid?.activeFilterValues && dateF in grid.activeFilterValues) {
    grid.activeFilterValues = { ...grid.activeFilterValues, [dateF]: TODAY };
    snapped++;
  }
  for (const o of w.fx.occurrences) {
    if (!o.filterOverride || !(dateF in o.filterOverride)) continue;
    o.filterOverride = { ...o.filterOverride, [dateF]: TODAY };
    snapped++;
  }
  // THE CONTROL: the trackers read their period from these. If nothing carried
  // a date filter, every tracker below would read zero and the suite would be
  // measuring an empty world.
  expect(snapped, "no date filter to snap — the trackers would have no period").toBeGreaterThan(0);
  return snapped;
}

/**
 * The SCHEDULE day column — the one holding the day's slots, picked by child
 * count rather than by label (several columns share a date, and a label is two
 * fields on this grid). Re-dated to today when the fixture predates it.
 */
function scheduleColumn(w) {
  const dateF = fieldId(w, "Date");
  const dated = w.fx.occurrences.filter((o) => o.fields?.[dateF]?.value && (o.occurrences || []).length > 3);
  expect(dated.length, "the fixture holds no dated day column at all").toBeGreaterThan(0);

  const today = dated.filter((o) => o.fields[dateF].value === TODAY);
  const pick = (list) => list.slice().sort((a, b) => (b.occurrences || []).length - (a.occurrences || []).length)[0];
  if (today.length) return pick(today);

  // Newest by date, then widest — the schedule column, not a Day Page column
  // that happens to share the date.
  const newestDate = dated.map((o) => o.fields[dateF].value).sort().pop();
  const col = pick(dated.filter((o) => o.fields[dateF].value === newestDate));
  col.fields[dateF] = { ...(col.fields[dateF] || {}), value: TODAY };
  expect(col.fields[dateF].value, "the re-date did not land").toBe(TODAY);
  return col;
}

/**
 * Put the world in the state the app is in on the first load of a day, and hand
 * back the schedule column to inject into.
 */
export function ensureTodaysColumn(w) {
  snapFiltersToToday(w);
  const col = scheduleColumn(w);
  // Both halves have to agree or the injection is invisible: the column is the
  // ancestry the gates require, the filter is the PERIOD they compare against.
  expect(col.fields[fieldId(w, "Date")].value, "the column is not on today").toBe(TODAY);
  return col;
}
