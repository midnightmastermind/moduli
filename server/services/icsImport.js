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

const isZone = (z) => {
  if (!z || typeof z !== "string") return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return true; } catch { return false; }
};

/**
 * @param timeZone the USER's zone. When it is unknown (null), each event is
 *   read in the zone its own invite names — the time the invite shows — and
 *   `zoneGuessed` is set so the caller can say so. UTC is the last resort.
 */
// A property that carries PARAMETERS (Outlook writes `SUMMARY;LANGUAGE=en-US:…`)
// comes out of node-ical as `{ params, val }`, not a string — String() on it
// titled every such invite "[object Object]" (found on real invites, 2026-09-24).
export function icsText(v) {
  if (v == null) return "";
  if (typeof v === "object") return icsText(v.val ?? "");
  return String(v);
}

export function parseIcs(text, { timeZone = null, expand = null } = {}) {
  let parsed;
  try { parsed = ical.sync.parseICS(String(text || "")); }
  catch { return { events: [], skipped: 0, zoneGuessed: false }; }

  const userZone = isZone(timeZone) ? timeZone : null;
  let zoneGuessed = false;
  const events = [];
  for (const v of Object.values(parsed || {})) {
    if (!v || v.type !== "VEVENT" || !v.start) continue;

    const allDay = v.datetype === "date";
    let zone = userZone;
    if (!zone) {
      zoneGuessed = true;
      zone = isZone(v.start.tz) ? v.start.tz : "UTC";
    }
    const lengthMs = v.end && v.end > v.start ? v.end - v.start : 0;
    const one = (start, end, uid, recurring) => {
      const s = inZone(start, zone);
      const e = end ? inZone(end, zone) : null;
      return {
        summary: icsText(v.summary).trim() || "(no title)",
        start: { date: s.date, time: allDay ? null : s.time, timeSlot: null },
        end:   e ? { date: e.date, time: allDay ? null : e.time } : null,
        // An invite whose DTEND equals its DTSTART states no length (the clinic
        // invites that found this: every one, 2026-09-24). null, not 0 — a
        // "Duration 0" chip claims a length the sender never gave, and the
        // Schedule places both the same way (in the start slot).
        durationMin: (end && !allDay && end > start) ? Math.round((end - start) / 60000) : null,
        allDay,
        location: icsText(v.location) || null,
        description: icsText(v.description) || null,
        organizer: v.organizer?.val ? String(v.organizer.val) : null,
        uid,
        recurring,
      };
    };
    const uid = v.uid ? String(v.uid) : null;
    // A SUBSCRIPTION expands a repeating event over its window (feeds.js); each occurrence gets
    // its own identity `<UID>@<date>` so it is its own row, and an EXDATE / moved instance is honoured.
    // A one-off share keeps the first occurrence only (D12).
    if (v.rrule && expand && uid) {
      const exdates = new Set(Object.values(v.exdate || {}).map((d) => new Date(d).toISOString()));
      for (const at of v.rrule.between(expand.from, expand.to, true)) {
        if (exdates.has(new Date(at).toISOString())) continue;
        const key = inZone(at, zone).date;
        const moved = Object.values(v.recurrences || {}).find((r) => r?.recurrenceid && inZone(r.recurrenceid, zone).date === key);
        if (moved?.status === "CANCELLED") continue;
        const st = moved?.start || at;
        const en = moved?.end || (lengthMs ? new Date(new Date(st).getTime() + lengthMs) : null);
        const ev = one(st, en, `${uid}@${key}`, true);
        if (moved?.summary) ev.summary = icsText(moved.summary).trim() || ev.summary;
        events.push(ev);
      }
      continue;
    }
    if (expand && v.status === "CANCELLED") continue;
    events.push(one(v.start, v.end, uid, !!v.rrule));   // FIRST OCCURRENCE ONLY when not expanded
  }
  return { events, skipped: 0, zoneGuessed };
}
