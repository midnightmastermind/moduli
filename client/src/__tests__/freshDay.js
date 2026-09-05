// Strip every day column from a fixture world, so a sweep REBUILDS one.
//
// WHY THIS EXISTS: `pomsGrid.json.br` is a snapshot of a live grid, and several
// suites assert on what the load sweep CREATES — the day column, the daily
// question, the slot copies. Whether any of that is still to do depends
// entirely on what the grid happened to look like the moment the fixture was
// exported. Refreshing it on 2026-09-05 turned three green assertions red:
// `Math.random` was never consulted (the Daily Question Rotator had nothing to
// rotate) and pass 1 of the two-pass test created nothing (today's column was
// already built).
//
// Neither was a regression. They were passing by accident of export timing —
// the trap this repo already recorded on 2026-08-20 (6): *"any test whose
// premise is 'this column starts empty' is a coin flip on export timing."*
// The remedy there was the same as here: THE HARNESS CONSTRUCTS THE CONDITION
// IT MEASURES rather than hoping the snapshot caught it.
//
// Measured on the 2026-09-05 fixture: stripping takes the sweep from
// 0 CREATE_ITEM / 0 random calls to 95 / 1.
//
// It removes the columns AND unlists them from every parent, because a parent
// still naming a deleted child is the dangling-child-ref shape this repo has
// swept five times — and here it would make the rebuild look like a duplicate.

/**
 * @param {Record<string, object>} occurrencesById  mutated in place
 * @param {Array<object>} fields                    the fixture's field list
 * @returns {number} how many columns were removed — assert on it, or a strip
 *                   that silently matched nothing leaves the test exactly as
 *                   fragile as it was before.
 */
export function stripDayColumns(occurrencesById, fields) {
  // Found the way the grid itself identifies them, not by label: a Schedule day
  // column carries `Schedule Format = "day-col"`, a Day Page column carries the
  // dated identity signature `0284` stamps.
  const sf = (fields || []).find((f) => f.name === "Schedule Format")?.id;
  const doomed = Object.values(occurrencesById).filter(
    (o) =>
      (sf && o.fields?.[sf]?.value === "day-col") ||
      String(o.identitySignature || "").startsWith("daypage:col:")
  );
  const ids = new Set(doomed.map((o) => o.id));
  for (const id of ids) delete occurrencesById[id];
  for (const o of Object.values(occurrencesById)) {
    if (Array.isArray(o.occurrences) && o.occurrences.some((c) => ids.has(c))) {
      o.occurrences = o.occurrences.filter((c) => !ids.has(c));
    }
  }
  return ids.size;
}
