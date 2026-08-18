// helpers/dueSpan.js
//
// Which days a due-dated task belongs in.
//
// User, 2026-08-07: *"stuff with a due date should be put in the Due slot,
// everyday until its due … if its completed and on the schedule, we can stop
// displaying it the next day."*
//
// ── ONE OCCURRENCE, MANY DAYS (user's decision, 2026-08-07) ────────────────
//
// The task is MULTI-PARENTED into each day's Due container — the same row listed
// by several days, the way the Schedule's shared slots and the Todo container
// already work. That is what makes the completion rule trivial: tick it once and
// it is complete everywhere, so "stop showing it tomorrow" is a fact about the
// row rather than something the builder has to reconstruct by scanning previous
// days for a copy that happens to be ticked.
//
// So this file answers only WHICH DAYS. The placement (multi-parent into each
// day's Due container, found by its field-based identity marker and never by
// label) is the caller's.
//
// ── DATES ARE DAY KEYS, NOT Date OBJECTS ───────────────────────────────────
//
// Everything here is `YYYY-MM-DD` string comparison. This codebase has been
// bitten by UTC rollover repeatedly — `$today` and the filter-nav defaults both
// had to be moved off `toISOString()` because west of UTC it produced tomorrow
// after local evening. String comparison on a local day key cannot drift.

/** Normalize a stored date value to a `YYYY-MM-DD` key, or null. */
export function dayKey(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // LOCAL parts, never toISOString — see the header.
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(value).trim();
  // A stored value is usually already `YYYY-MM-DD`, sometimes a full ISO
  // datetime. Slice rather than parse: parsing re-introduces the tz shift the
  // slice exists to avoid.
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : null;
}

/**
 * Should this task be listed in the Due container of `day`?
 *
 * @param {object}  task
 * @param {string}  task.due          due date (day key or ISO)
 * @param {string?} task.completedOn  the day it was completed, if it was
 * @param {string?} task.from         the first day it is relevant (its own date /
 *                                    creation day). Absent = no lower bound.
 * @param {string}  day               the day being built
 *
 * RULES — each a decision, not an obvious consequence:
 *
 *  • **Up to and INCLUDING the due date.** "Every day until it's due" reads as
 *    including the day it is due; that is the day it matters most.
 *
 *  • **An OVERDUE task NAGS FOR THREE DAYS, then stops.** The original reading
 *    was that it stays until dealt with, because the user had not said — and a
 *    task vanishing because its date went by is indistinguishable from losing
 *    it. They have now said (2026-08-18): *"i also need you to not put past dues
 *    in the todo list after 3 days, just leave them in the tasks folder so i can
 *    delete them."*
 *
 *    NOTHING IS DELETED AND NOTHING IS LOST — this decides only which days the
 *    schedule LISTS it on. The task itself still lives on the Tasks page, which
 *    is exactly where the user asked to be able to go and delete it. So the
 *    original worry does not apply: the row does not disappear, it stops
 *    following you around.
 *
 *  • **Completed → gone from the NEXT day on, kept on the day it was completed.**
 *    The user's sentence exactly, and it makes each day read truthfully: the day
 *    you did it still shows that you did it.
 *
 *  • **`from` is what stops "every day" meaning every day in history.** Without
 *    it, navigating to last month would show a task created yesterday. It is
 *    optional because the caller only ever builds days in the visible period,
 *    where the question rarely arises — but a builder that CAN look backwards
 *    must pass it.
 */
/** How many days an overdue task keeps appearing before the schedule lets it go.
 *  Named and exported because it is a product decision, not a tuning constant —
 *  and because a test that hardcodes 3 would silently stop testing the rule the
 *  day it changes. */
export const OVERDUE_GRACE_DAYS = 3;

/** `YYYY-MM-DD` plus n days, still as a day key.
 *  Built from UTC parts and read back as UTC parts: a day key carries no time,
 *  so this cannot drift the way local-midnight arithmetic does around DST — the
 *  same reason everything else here compares strings rather than Dates. */
export function addDays(key, n) {
  const k = dayKey(key);
  if (!k) return null;
  const [y, m, d] = k.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + n);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

export function isDueOn(task, day) {
  const d = dayKey(day);
  const due = dayKey(task?.due);
  if (!d || !due) return false;

  const from = dayKey(task?.from);
  if (from && d < from) return false; // before it existed

  const done = dayKey(task?.completedOn);
  if (done) return d <= done;         // completed: never after that day

  // Outstanding: every day up to the due date, then a THREE-DAY grace and no
  // more. The window is counted from the due date, so the task is listed on the
  // due day itself and on the three days after it.
  return d <= addDays(due, OVERDUE_GRACE_DAYS);
}

/**
 * The days from `dayKeys` this task belongs in — the list form, which is what a
 * builder iterating a period actually wants.
 */
export function daysDueOn(task, dayKeys = []) {
  return dayKeys.filter((d) => isDueOn(task, d));
}
