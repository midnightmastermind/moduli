// server/services/slotSnap.js
//
// The ONE place a time becomes a slot label (spec D11: FLOOR, not nearest).
//
// An event belongs in the slot it is actually inside. "Nearest" would move a
// 2:55 start into the 3:00 slot, and the Schedule's own placement
// (`SLOTS_COVERED`, client helpers/slotSpan.js) REFUSES a start time that is
// not exactly one of its slots — so an unfloored 2:17 would be placed nowhere.
//
// The labels come from the destination's own slots — the Schedule's slot
// vocabulary is data, and a hardcoded list would break the moment a board uses
// 15-minute slots.
//
// `slotLabelToMinutes` is the server twin of the client's function of the same
// name (client/src/helpers/slotSpan.js). The server never imports client code
// at runtime, so the twin is pinned by a test that runs BOTH over the same
// labels — if either changes alone, that test fails.

/** "2:00pm" / "2:00 PM" / "14:00" → minutes since midnight, or null. */
export function slotLabelToMinutes(label) {
  const s = String(label ?? "").trim().toLowerCase();
  if (!s) return null;
  let m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/.exec(s);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3] === "pm") h += 12;
    return h * 60 + Number(m[2] || 0);
  }
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
 * The slot an event starting at `time` ("HH:MM", 24-hour) is inside.
 * Before the first slot → the FIRST (an 8am event on a board that starts at 1pm
 * belongs at the top, not nowhere); after the last → the LAST.
 * Null only when there is no time or no usable slot — never a guess.
 */
export function floorToSlot(time, slotLabels = []) {
  const mins = slotLabelToMinutes(time);
  if (mins == null || !Array.isArray(slotLabels) || !slotLabels.length) return null;

  const parsed = slotLabels
    .map((label) => ({ label, mins: slotLabelToMinutes(label) }))
    .filter((s) => s.mins != null)
    .sort((a, b) => a.mins - b.mins);
  if (!parsed.length) return null;

  let best = parsed[0];
  for (const s of parsed) { if (s.mins <= mins) best = s; else break; }
  return best.label;
}
