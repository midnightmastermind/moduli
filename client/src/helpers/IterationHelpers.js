/**
 * IterationHelpers.js
 * Iteration matching logic — determines whether an occurrence should be
 * visible for a given currentIterationValue (date).
 */

/**
 * Returns true if the occurrence should be shown for the given iteration date.
 * @param {Object} occ - Occurrence with iteration field
 * @param {Date|string} currentIterationValue - Active iteration date
 */
export function occurrenceMatchesIteration(occ, currentIterationValue) {
  if (!occ?.iteration) return true; // no iteration info = always show
  const mode = occ.iteration.mode;
  if (mode === "persistent") return true;

  if (!currentIterationValue) return true; // can't filter without a target date

  const occDate = (occ.iteration.timeValue || occ.iteration.value)
    ? new Date(occ.iteration.timeValue || occ.iteration.value)
    : null;
  const curDate = new Date(currentIterationValue);

  if (!occDate) return true;

  // Normalize to date-only comparison
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (mode === "specific") {
    return sameDay(occDate, curDate);
  }

  if (mode === "untilDone") {
    const completedOn = occ.iteration.completedOn ? new Date(occ.iteration.completedOn) : null;
    if (!completedOn) return true; // not done yet → always visible
    return sameDay(completedOn, curDate);
  }

  return true;
}
