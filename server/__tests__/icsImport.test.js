// server/__tests__/icsImport.test.js
//
// TIMEZONES ARE THE TRAP, not a detail. DTSTART comes in three forms and only
// one of them is unambiguous. An evening event resolved in the wrong zone lands
// on the WRONG DAY, which is a silent, plausible-looking error.
import { describe, it, expect } from "vitest";
import { parseIcs } from "../services/icsImport.js";

const wrap = (body) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR`;
const TZ = "America/Chicago";

describe("parseIcs", () => {
  it("reads SUMMARY, UID and a plain local time", () => {
    const { events } = parseIcs(wrap(
      `BEGIN:VEVENT\r\nUID:abc\r\nSUMMARY:Dentist\r\n` +
      `DTSTART;TZID=America/Chicago:20260925T140000\r\n` +
      `DTEND;TZID=America/Chicago:20260925T150000\r\nEND:VEVENT`), { timeZone: TZ });
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("Dentist");
    expect(events[0].uid).toBe("abc");
    expect(events[0].start.date).toBe("2026-09-25");
    expect(events[0].start.time).toBe("14:00");
    expect(events[0].durationMin).toBe(60);
  });

  it("converts a UTC (Z-suffixed) start into the USER'S local date", () => {
    // 01:30Z on the 26th is 20:30 on the 25th in Chicago. Naive handling files
    // this on the wrong day.
    const { events } = parseIcs(wrap(
      `BEGIN:VEVENT\r\nUID:z1\r\nSUMMARY:Late call\r\n` +
      `DTSTART:20260926T013000Z\r\nDTEND:20260926T023000Z\r\nEND:VEVENT`), { timeZone: TZ });
    expect(events[0].start.date).toBe("2026-09-25");
    expect(events[0].start.time).toBe("20:30");
  });

  it("honours a TZID that is NOT the user's zone", () => {
    // 22:00 in New York is 21:00 in Chicago, same day.
    const { events } = parseIcs(wrap(
      `BEGIN:VEVENT\r\nUID:ny\r\nSUMMARY:NY call\r\n` +
      `DTSTART;TZID=America/New_York:20260925T220000\r\n` +
      `DTEND;TZID=America/New_York:20260925T230000\r\nEND:VEVENT`), { timeZone: TZ });
    expect(events[0].start.date).toBe("2026-09-25");
    expect(events[0].start.time).toBe("21:00");
  });

  it("treats a floating time as local, unshifted", () => {
    const { events } = parseIcs(wrap(
      `BEGIN:VEVENT\r\nUID:f1\r\nSUMMARY:Floating\r\n` +
      `DTSTART:20260925T090000\r\nDTEND:20260925T093000\r\nEND:VEVENT`), { timeZone: TZ });
    expect(events[0].start.date).toBe("2026-09-25");
    expect(events[0].start.time).toBe("09:00");
    expect(events[0].durationMin).toBe(30);
  });

  it("marks an all-day event and leaves time null", () => {
    const { events } = parseIcs(wrap(
      `BEGIN:VEVENT\r\nUID:ad\r\nSUMMARY:Holiday\r\n` +
      `DTSTART;VALUE=DATE:20260925\r\nDTEND;VALUE=DATE:20260926\r\nEND:VEVENT`), { timeZone: TZ });
    expect(events[0].allDay).toBe(true);
    expect(events[0].start.date).toBe("2026-09-25");
    expect(events[0].start.time).toBe(null);
  });

  it("imports the FIRST occurrence of a recurring event and flags it (D12)", () => {
    const { events } = parseIcs(wrap(
      `BEGIN:VEVENT\r\nUID:r1\r\nSUMMARY:Standup\r\n` +
      `DTSTART;TZID=America/Chicago:20260925T090000\r\n` +
      `DTEND;TZID=America/Chicago:20260925T091500\r\n` +
      `RRULE:FREQ=WEEKLY;COUNT=50\r\nEND:VEVENT`), { timeZone: TZ });
    expect(events).toHaveLength(1);
    expect(events[0].recurring).toBe(true);
    expect(events[0].start.date).toBe("2026-09-25");
  });

  it("reads EVERY event in a multi-event file — no cap (D20)", () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      `BEGIN:VEVENT\r\nUID:m${i}\r\nSUMMARY:E${i}\r\n` +
      `DTSTART;TZID=America/Chicago:2026092${(i % 9) + 1}T100000\r\n` +
      `DTEND;TZID=America/Chicago:2026092${(i % 9) + 1}T110000\r\nEND:VEVENT`).join("\r\n");
    expect(parseIcs(wrap(many), { timeZone: TZ }).events).toHaveLength(120);
  });

  it("carries LOCATION and DESCRIPTION through", () => {
    const { events } = parseIcs(wrap(
      `BEGIN:VEVENT\r\nUID:l1\r\nSUMMARY:S\r\nLOCATION:Main St\r\nDESCRIPTION:Bring forms\r\n` +
      `DTSTART;TZID=America/Chicago:20260925T140000\r\n` +
      `DTEND;TZID=America/Chicago:20260925T150000\r\nEND:VEVENT`), { timeZone: TZ });
    expect(events[0].location).toBe("Main St");
    expect(events[0].description).toBe("Bring forms");
  });

  it("returns an empty list for junk rather than throwing", () => {
    expect(parseIcs("not a calendar", { timeZone: TZ }).events).toEqual([]);
  });

  // ── Beyond the plan: what real calendars send ─────────────────────────────
  it("understands Outlook's WINDOWS zone names (\"Central Standard Time\")", () => {
    // Outlook/Exchange invites carry Windows zone ids, not IANA ones. Read as
    // UTC, a 2pm Chicago meeting would land at 9am.
    const { events } = parseIcs(wrap(
      `BEGIN:VEVENT\r\nUID:ol\r\nSUMMARY:Outlook\r\n` +
      `DTSTART;TZID=Central Standard Time:20260925T140000\r\n` +
      `DTEND;TZID=Central Standard Time:20260925T143000\r\nEND:VEVENT`), { timeZone: TZ });
    expect(events[0].start.time).toBe("14:00");
    expect(events[0].durationMin).toBe(30);
  });

  it("unescapes text and unfolds long lines", () => {
    const { events } = parseIcs(wrap(
      `BEGIN:VEVENT\r\nUID:esc\r\nSUMMARY:Lunch\\, then errands\r\n` +
      `DESCRIPTION:A very long description that a calendar app has folded\r\n  onto a second line\r\n` +
      `DTSTART;TZID=America/Chicago:20260925T120000\r\n` +
      `DTEND;TZID=America/Chicago:20260925T130000\r\nEND:VEVENT`), { timeZone: TZ });
    expect(events[0].summary).toBe("Lunch, then errands");
    expect(events[0].description).toBe("A very long description that a calendar app has folded onto a second line");
  });

  it("derives the length from DURATION when there is no DTEND", () => {
    const { events } = parseIcs(wrap(
      `BEGIN:VEVENT\r\nUID:dur\r\nSUMMARY:Run\r\n` +
      `DTSTART;TZID=America/Chicago:20260925T070000\r\nDURATION:PT45M\r\nEND:VEVENT`), { timeZone: TZ });
    expect(events[0].durationMin).toBe(45);
  });

  it("an event with no title is still imported, named so you can find it", () => {
    const { events } = parseIcs(wrap(
      `BEGIN:VEVENT\r\nUID:nt\r\n` +
      `DTSTART;TZID=America/Chicago:20260925T070000\r\nDTEND;TZID=America/Chicago:20260925T080000\r\nEND:VEVENT`), { timeZone: TZ });
    expect(events[0].summary).toBe("(no title)");
  });
});

