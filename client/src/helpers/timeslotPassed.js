// helpers/timeslotPassed.js
//
// Pure check: is a container a "scheduleSlot" whose time has passed
// relative to the current clock for the day it represents?
//
// Inputs:
//   slotLabel:     "9:00am" / "12:00pm" / "11:30am" (PomodoroTimer.currentSlotLabel format)
//   containerDate: ISO string ("YYYY-MM-DD" or full ISO) — the day this slot occurrence is for
//   now:           a Date — typically the value returned by useNowTick
//
// Returns true when ALL hold:
//   1. containerDate is today (local timezone)
//   2. the slot's start time is earlier than `now`
//
// Task #59 per CLAUDE_CHAT.md 2026-05-22: timeslot containers in the
// Schedule for today get a slight red background once their hour has
// passed.

const SLOT_RE = /^(\d{1,2}):(\d{2})(am|pm)$/i;

export function parseSlotLabel(slotLabel) {
  if (!slotLabel || typeof slotLabel !== "string") return null;
  const m = SLOT_RE.exec(slotLabel.trim());
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ampm = m[3].toLowerCase();
  if (h === 12) h = 0;
  if (ampm === "pm") h += 12;
  return { h, min };
}

function sameLocalDay(a, b) {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
}

export function isTimeslotPassed({ slotLabel, containerDate, now } = {}) {
  if (!slotLabel || !now) return false;
  const parsed = parseSlotLabel(slotLabel);
  if (!parsed) return false;

  // containerDate optional — when present, the slot only counts as
  // "passed" if it belongs to today. (Yesterday's slots are stale
  // history; tomorrow's are future.) When absent, treat as today.
  // Important: bare "YYYY-MM-DD" parses as UTC midnight via the Date
  // constructor, which lands on the prior day in any timezone behind
  // UTC. Split + construct in local time to avoid the timezone slide.
  if (containerDate) {
    let d;
    if (containerDate instanceof Date) {
      d = containerDate;
    } else if (typeof containerDate === "string") {
      const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(containerDate);
      if (ymd) d = new Date(+ymd[1], +ymd[2] - 1, +ymd[3]);
      else d = new Date(containerDate);
    } else {
      d = new Date(containerDate);
    }
    if (Number.isNaN(d.getTime())) return false;
    if (!sameLocalDay(d, now)) return false;
  }

  const slotMinutes = parsed.h * 60 + parsed.min;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return slotMinutes < nowMinutes;
}
