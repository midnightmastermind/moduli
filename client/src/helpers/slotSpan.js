// helpers/slotSpan.js
//
// An appointment occupies EVERY slot it covers, not just the one it starts in.
//
// User, 2026-08-07: *"just put them in where they are supposed to go in the
// timeslot cause we have times to put it in. make sure they are in every
// timeslot its alloted for."* So Therapy 2:00pm–3:00pm belongs to the 2:00pm
// slot AND the 2:30pm slot.
//
// ── NO NEW FIELD, BY MEASUREMENT ───────────────────────────────────────────
//
// Measured on poms grid before writing: `Time Slot` is a 48-option select of
// half-hour labels ("2:00pm"), and `Duration` is a real duration field the
// Appointment action ALREADY binds. Start + length is the span — an "end time"
// field would be a second source of truth for something already derivable, and
// the two would drift the first time someone edited one of them.
//
// ── WHY THIS IS PURE, AND SEPARATE FROM PLACEMENT ──────────────────────────
//
// It answers only "which slot labels does this cover". WHETHER those slots each
// get their own copy or all list one occurrence is a placement decision that
// belongs to the caller — and for an appointment the answer has to be ONE
// occurrence multi-parented, because ticking Therapy off at 2:30 must not leave
// a second unticked Therapy at 2:00. The Schedule's shared slots are that
// pattern working correctly, and `createPageInContainer` carries the same
// warning about the copy alternative.
//
// The slot LABELS are passed in rather than generated here: they are the field's
// own options, and regenerating them would be a second definition of the day
// that could disagree with the one the grid actually uses.

/** "2:00pm" / "2:00 PM" / "14:00" → minutes since midnight, or null. */
export function slotLabelToMinutes(label) {
  const s = String(label ?? "").trim().toLowerCase();
  if (!s) return null;
  // 12-hour with meridiem
  let m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/.exec(s);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3] === "pm") h += 12;
    return h * 60 + Number(m[2] || 0);
  }
  // 24-hour
  m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }
  return null;
}

/**
 * The slot labels an appointment covers.
 *
 * @param {string} startLabel      the Time Slot value, e.g. "2:00pm"
 * @param {number} durationMinutes from the Duration field
 * @param {string[]} slotLabels    the Time Slot field's own options, in order
 *
 * @returns {string[]} covered labels, in clock order. ALWAYS at least the start
 *          slot when that slot exists — a zero, missing or unparseable duration
 *          means "we do not know how long", not "it occupies nothing", and an
 *          appointment that lands nowhere is worse than one that lands once.
 */
export function slotsCovered(startLabel, durationMinutes, slotLabels = []) {
  const start = slotLabelToMinutes(startLabel);
  if (start == null) return [];

  // Keep only labels this grid actually offers, sorted by clock rather than by
  // array order — a caller may hand them over unsorted, and the RESULT is what
  // gets rendered in a day column.
  const known = slotLabels
    .map((l) => ({ label: l, min: slotLabelToMinutes(l) }))
    .filter((x) => x.min != null)
    .sort((a, b) => a.min - b.min);
  if (!known.length) return [];

  const startsAt = known.find((x) => x.min === start);
  if (!startsAt) return []; // a time the grid has no slot for — refuse rather than round

  const mins = Number(durationMinutes);
  // A half-open interval [start, start+duration): an appointment ending at 3:00
  // does NOT occupy the 3:00 slot, because that slot is free from 3:00. Using a
  // closed interval would make every back-to-back pair collide.
  const end = Number.isFinite(mins) && mins > 0 ? start + mins : start + 1;

  return known.filter((x) => x.min >= start && x.min < end).map((x) => x.label);
}

/**
 * Human summary of the span, for a label or a confirmation.
 * "2:00pm–3:00pm" — or just the start when the length is unknown.
 */
export function describeSpan(startLabel, durationMinutes, slotLabels = []) {
  const start = slotLabelToMinutes(startLabel);
  if (start == null) return "";
  const mins = Number(durationMinutes);
  if (!Number.isFinite(mins) || mins <= 0) return String(startLabel);
  const endMin = start + mins;
  // Prefer a real slot label for the end so the two ends read in one vocabulary;
  // fall back to formatting when the end is not on a slot boundary (a 45-minute
  // appointment ends at 2:45, which is not one of the 48).
  const known = slotLabels
    .map((l) => ({ label: l, min: slotLabelToMinutes(l) }))
    .filter((x) => x.min != null);
  const exact = known.find((x) => x.min === endMin % (24 * 60));
  return `${startLabel}–${exact ? exact.label : formatMinutes(endMin)}`;
}

/** minutes → "2:45pm". Only used for an end that is not on a slot boundary. */
export function formatMinutes(total) {
  const t = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const h24 = Math.floor(t / 60);
  const min = t % 60;
  const mer = h24 < 12 ? "am" : "pm";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(min).padStart(2, "0")}${mer}`;
}
