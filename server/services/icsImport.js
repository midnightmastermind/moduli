// server/services/icsImport.js
//
// VCALENDAR → the flat event catalogue in spec §3.
//
// TIMEZONES ARE THE CORRECTNESS TRAP. DTSTART arrives in three forms —
// TZID-qualified, UTC (Z-suffixed), or floating — and each resolves to a
// different local day. Every one has its own test; the library was chosen by
// passing them. node-ical (0.27) passed the zoned cases outright, including
// Outlook's WINDOWS zone names ("Central Standard Time"); the two zoneless
// cases are handled in `inZone` below.
//
// RECURRENCE IS NOT EXPANDED (D12). The first occurrence is imported and
// `recurring` is set, so the caller can say "recurrence not imported" rather
// than silently producing one row where fifty were expected.
import ical from "node-ical";

const pad = (n) => String(n).padStart(2, "0");

/**
 * A parsed DTSTART/DTEND → { date: "YYYY-MM-DD", time: "HH:MM" } in the USER'S zone.
 *
 * Only a value that NAMES a zone (a TZID, or a Z-suffixed UTC time — node-ical
 * puts it on `d.tz`) is a real instant to convert. A FLOATING time and an
 * ALL-DAY date name none: node-ical builds them from the written clock time in
 * the SERVER'S zone, so they are read back with the local getters exactly as
 * written. Converting them would shift a floating 9:00 by the server's offset
 * and move an all-day date to the previous day — found by the tests, with the
 * server in UTC and the user in Chicago.
 */
function inZone(d, timeZone) {
  if (!d.tz) {
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    };
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).reduce((a, p) => (a[p.type] = p.value, a), {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`,
  };
}

export function parseIcs(text, { timeZone = "UTC" } = {}) {
  let parsed;
  try { parsed = ical.sync.parseICS(String(text || "")); }
  catch { return { events: [], skipped: 0 }; }

  const events = [];
  for (const v of Object.values(parsed || {})) {
    if (!v || v.type !== "VEVENT" || !v.start) continue;

    const allDay = v.datetype === "date";
    const s = inZone(v.start, timeZone);
    const e = v.end ? inZone(v.end, timeZone) : null;

    events.push({
      summary: String(v.summary || "").trim() || "(no title)",
      start: { date: s.date, time: allDay ? null : s.time, timeSlot: null },
      end:   e ? { date: e.date, time: allDay ? null : e.time } : null,
      durationMin: (v.end && !allDay)
        ? Math.max(0, Math.round((v.end - v.start) / 60000)) : null,
      allDay,
      location: v.location ? String(v.location) : null,
      description: v.description ? String(v.description) : null,
      organizer: v.organizer?.val ? String(v.organizer.val) : null,
      uid: v.uid ? String(v.uid) : null,
      recurring: !!v.rrule,          // FIRST OCCURRENCE ONLY — not expanded
    });
  }
  return { events, skipped: 0 };
}
