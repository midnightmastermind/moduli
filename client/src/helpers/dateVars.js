// Date labels shared by the operation executor and anything that needs to name
// the window a tracker is showing.
//
// WHY THIS IS ITS OWN FILE: the executor builds `$activeDate`,
// `$activeDateLabel`, `$activeDayOfWeek` and `$activeDatePossessive` inside a
// closure over its own local state, so none of them is reachable from a test.
// This is the one piece that is pure, and it is the piece with a boundary that
// bites.

/**
 * "September 2026" — the month a date falls in.
 *
 * PARSES A BARE `YYYY-MM-DD` AS LOCAL MIDNIGHT, which is the whole reason this
 * is a function rather than an inline `toLocaleDateString`. `new Date("2026-09-01")`
 * is UTC midnight, i.e. the previous day — and therefore the PREVIOUS MONTH —
 * in every US timezone, so the 1st of a month would label itself as the month
 * before. `weekday:` and `dateLong:` in `operationActions` carry the same parse
 * for the same reason.
 *
 * Answers "" for anything unparseable rather than inventing a month: a tracker
 * label reading "Invalid Date" is at least honest, one reading the wrong month
 * is not.
 */
export function monthLabelOf(dateLike) {
  if (!dateLike) return "";
  let d;
  if (dateLike instanceof Date) d = dateLike;
  else {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateLike));
    d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(String(dateLike));
  }
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
