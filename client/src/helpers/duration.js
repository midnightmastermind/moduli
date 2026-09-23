// helpers/duration.js
//
// WHAT A `duration` FIELD'S VALUE MEANS, in one place.
//
// The stored value is a NUMBER OF MINUTES. That is what the hours+minutes
// editor writes (`h * 60 + m`) and what every display reads back. Nothing here
// learns what any particular duration field is for.
//
// It was written out FOUR times, and the copies disagreed:
//
//   Field.jsx  case "duration"   120 -> "2h"        (h/m suppressed when zero)
//   useDocFieldValues.js          120 -> "2h 0m"     (always both parts)
//   Field.jsx  compact pill       120 -> "120"       (never formatted at all)
//   Field.jsx  h/m editor/display split into two boxes
//
// So the same field read "2h" on a board row, "2h 0m" in a doc pill and "120"
// in the compact pill you click to edit it. The first of those is the one the
// app shows most and the one whose empty state the code already documents as
// `"0m"` (Field.jsx's empty-display branch), so it is the canonical form here.
//
// ── AND THE TYPE IS NOT GUARANTEED, which is why `toMinutes` coerces ────────
//
// The compact pill's editor stored whatever was typed as a STRING while the
// h/m editor stored a number. Watched directly on prod 2026-09-22: typing into
// a bound duration pill stored `"1"`, not `1`. And one field already holds both
// types — poms grid's `Duration`:
//
//     19 rows with a value   ->   12 numbers (60, 120)   7 strings ("60", "120")
//
// WHAT WROTE THOSE SEVEN IS NOT ESTABLISHED, and the data argues against the
// obvious answer: none of them carries a `timestamp` or a `userTouched` row,
// which a UI edit leaves behind. They may well predate this path. What IS
// established is that the compact editor produces strings and that the field
// holds both — which is enough reason for readers to coerce.
//
// `useDocFieldValues` formatted only `typeof value === "number"` and fell
// through to `String(value)` otherwise, so those seven rendered as a bare
// "60" in every doc pill. Coercing here means a value already in the database
// reads correctly whichever editor wrote it; the compact editor now writes a
// number, so no new ones are made.

/**
 * The value as a number of minutes, or 0 when it is not a number at all.
 * Accepts the numeric strings already in the database.
 * @param {unknown} value
 * @returns {number}
 */
export function toMinutes(value) {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Whether a stored value can be read as minutes at all. A duration holding
 * prose ("about an hour") is not something to render as 0m silently — callers
 * that have something better to show (the raw text) can ask first.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isMinutes(value) {
  if (value === null || value === undefined || value === "") return false;
  return Number.isFinite(Number(value));
}

/**
 * Minutes split for the two-box editor and its read-only twin.
 * @param {unknown} value
 * @returns {{hours: number, minutes: number}}
 */
export function splitDuration(value) {
  const total = toMinutes(value);
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/**
 * The canonical one-line form: "0m", "45m", "2h", "1h 30m".
 *
 * A whole number of hours drops the minutes, and a duration under an hour
 * drops the hours — printing "2h 0m" reads like a measurement that happens to
 * be zero rather than a round two hours.
 *
 * A value that is not minutes at all comes back as its own string, so prose
 * someone typed is shown rather than silently replaced with "0m".
 * @param {unknown} value
 * @returns {string}
 */
export function formatDuration(value) {
  if (!isMinutes(value)) {
    return value === null || value === undefined || value === "" ? "0m" : String(value);
  }
  const { hours, minutes } = splitDuration(value);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
