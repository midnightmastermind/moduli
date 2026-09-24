// server/__tests__/shareIngress.test.js
//
// INGRESS PREPARES, THE RULE ROUTES (spec §3).
import { describe, it, expect } from "vitest";
import { prepareShare, shareLabelFor, shareExternalIdFor } from "../services/shareIngress.js";

const okPreview = async (url) => ({ ok: true, url, title: "Example Page", favicon: "https://x.test/f.ico", cover: "https://x.test/c.jpg" });

describe("prepareShare", () => {
  it("fetches link metadata BEFORE any rule runs, and labels from it", async () => {
    const s = await prepareShare({ userId: "u1", gridId: "g1", url: "https://x.test/a", fetchPreview: okPreview });
    expect(s.type).toBe("link");
    expect(s.props.title).toBe("Example Page");
    expect(s.props.image).toBe("https://x.test/c.jpg");
    expect(s.label).toBe("Example Page");
  });

  it("a dead link still shares, labelled by its url", async () => {
    const s = await prepareShare({ userId: "u1", gridId: "g1", url: "https://dead.test/a",
      fetchPreview: async () => ({ ok: false, error: "nope" }) });
    expect(s.label).toBe("https://dead.test/a");
    expect(s.props.title).toBeNull();
  });

  it("a throwing preview does not lose the share", async () => {
    const s = await prepareShare({ userId: "u1", gridId: "g1", url: "https://x.test/a",
      fetchPreview: async () => { throw new Error("dns"); } });
    expect(s.type).toBe("link");
  });

  it("keys a link on the extension's <shape>:<url> scheme (D15)", async () => {
    const s = await prepareShare({ userId: "u1", gridId: "g1", url: "https://x.test/a", shape: "page" });
    expect(s.externalId).toBe("page:https://x.test/a");
  });

  it("defaults a link's shape to `link`", async () => {
    const s = await prepareShare({ userId: "u1", gridId: "g1", url: "https://x.test/a" });
    expect(s.externalId).toBe("link:https://x.test/a");
  });

  it("an explicit label wins over the fetched title", async () => {
    const s = await prepareShare({ userId: "u1", gridId: "g1", url: "https://x.test/a", label: "Mine", fetchPreview: okPreview });
    expect(s.label).toBe("Mine");
  });

  it("labels text by its first line", async () => {
    const s = await prepareShare({ userId: "u1", gridId: "g1", text: "Buy milk\nand eggs" });
    expect(s.type).toBe("text");
    expect(s.label).toBe("Buy milk");
  });

  it("carries the source so a rule can branch on where it came from", async () => {
    const s = await prepareShare({ userId: "u1", gridId: "g1", source: "android", text: "hi" });
    expect(s.source).toBe("android");
  });

  it("REFUSES a file rather than dropping it while file upload is unwired", async () => {
    await expect(prepareShare({ userId: "u1", gridId: "g1",
      files: [{ filename: "a.jpg", mimetype: "image/jpeg", size: 1 }] }))
      .rejects.toMatchObject({ code: "files_unsupported" });
  });

  it("with a storeFile, exposes the uploaded ids and keys on the hash", async () => {
    const s = await prepareShare({ userId: "u1", gridId: "g1",
      files: [{ filename: "a.jpg", mimetype: "image/jpeg", size: 1 }],
      storeFile: async () => ({ occurrenceId: "occ-file", fileRef: "user/2026-09/a.jpg", sha256: "abc" }) });
    expect(s.props.occurrenceId).toBe("occ-file");
    expect(s.externalId).toBe("sha256:abc");
  });
});

describe("labels and keys", () => {
  it("trims a long label", () => {
    expect(shareLabelFor("text", { firstLine: "x".repeat(300) }).length).toBeLessThanOrEqual(120);
  });
  it("keys text on its content", () => {
    expect(shareExternalIdFor("text", { text: "hello  world" })).toBe("text:hello world");
  });
});

// ── A shared CALENDAR (Plan 2, Task 3) ───────────────────────────────────
import fsx from "node:fs";
import osx from "node:os";
import pathx from "node:path";
const cal = (...events) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join("\r\n")}\r\nEND:VCALENDAR`;
const vevent = (uid, summary, start, end, extra = "") =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${summary}\r\nDTSTART;TZID=America/Chicago:${start}\r\n` +
  `DTEND;TZID=America/Chicago:${end}\r\n${extra}END:VEVENT`;
const stubStore = async () => ({ occurrenceId: "f", fileRef: "x", sha256: "h" });
const icsFile = (text) => ({ filename: "invite.ics", mimetype: "application/octet-stream", size: text.length, text });

describe("ics ingress", () => {
  it("exposes events on $share so a rule can LOOP them, start FLOORED onto the grid's slots (D11)", async () => {
    const share = await prepareShare({
      userId: "u1", gridId: "g1", source: "android", timeZone: "America/Chicago",
      storeFile: stubStore, files: [icsFile(cal(vevent("a", "Dentist", "20260925T141700", "20260925T151700")))],
      resolveSlotLabels: async () => ["2:00pm", "2:30pm", "3:00pm"],
    });
    expect(share.type).toBe("ics");
    expect(share.events).toHaveLength(1);
    expect(share.events[0].summary).toBe("Dentist");
    expect(share.events[0].start.timeSlot).toBe("2:00pm");
    expect(share.events[0].durationMin).toBe(60);
  });

  it("gives each event its OWN externalId from the UID, so re-sharing updates (§7)", async () => {
    const share = await prepareShare({ userId: "u1", gridId: "g1", timeZone: "America/Chicago",
      storeFile: stubStore, files: [icsFile(cal(vevent("a", "A", "20260925T090000", "20260925T100000"),
                          vevent("b", "B", "20260925T110000", "20260925T120000")))],
      resolveSlotLabels: async () => ["9:00am", "11:00am"] });
    expect(share.events.map(e => e.externalId)).toEqual(["ics:a", "ics:b"]);
  });

  it("reports recurrence rather than silently importing one of fifty (D12)", async () => {
    const share = await prepareShare({ userId: "u1", gridId: "g1", timeZone: "America/Chicago",
      storeFile: stubStore, files: [icsFile(cal(vevent("r", "Standup", "20260925T090000", "20260925T091500", "RRULE:FREQ=WEEKLY;COUNT=50\r\n")))],
      resolveSlotLabels: async () => ["9:00am"] });
    expect(share.notices.join(" ")).toMatch(/recurrence not imported/);
  });

  it("says so when the grid has no time slots, instead of placing by a guess", async () => {
    const share = await prepareShare({ userId: "u1", gridId: "g1", timeZone: "America/Chicago",
      storeFile: stubStore, files: [icsFile(cal(vevent("a", "A", "20260925T090000", "20260925T100000")))],
      resolveSlotLabels: async () => [] });
    expect(share.events[0].start.timeSlot).toBe(null);
    expect(share.notices.join(" ")).toMatch(/no time slots/);
  });

  it("reads the calendar from disk BEFORE storing — storing moves the temp file", async () => {
    const p = pathx.join(fsx.mkdtempSync(pathx.join(osx.tmpdir(), "ics-")), "invite.ics");
    fsx.writeFileSync(p, cal(vevent("a", "From disk", "20260925T090000", "20260925T100000")));
    const share = await prepareShare({ userId: "u1", gridId: "g1", timeZone: "America/Chicago",
      files: [{ filename: "invite.ics", mimetype: "text/calendar", size: 10, path: p }],
      storeFile: async ({ file }) => { fsx.unlinkSync(file.path); return { occurrenceId: "f", fileRef: "x", sha256: "h" }; },
      resolveSlotLabels: async () => ["9:00am"] });
    expect(share.events[0].summary).toBe("From disk");
    expect(share.props.occurrenceId).toBe("f");
  });

  it("does not look slots up for an all-day-only calendar", async () => {
    let asked = 0;
    await prepareShare({ userId: "u1", gridId: "g1", timeZone: "America/Chicago",
      storeFile: stubStore, files: [icsFile(cal("BEGIN:VEVENT\r\nUID:h\r\nSUMMARY:Holiday\r\nDTSTART;VALUE=DATE:20260925\r\nEND:VEVENT"))],
      resolveSlotLabels: async () => { asked++; return []; } });
    expect(asked).toBe(0);
  });
});

// ── A calendar LINK (webcal:// or an .ics url) ────────────────────────────
import { isCalendarUrl, calendarFetchUrl } from "../services/shareIngress.js";
describe("a calendar link is read as a calendar", () => {
  const CAL = cal(vevent("w1", "Standup", "20260925T090000", "20260925T093000"));
  it("fetches a webcal:// link over https and exposes its events", async () => {
    const asked = [];
    const share = await prepareShare({ userId: "u1", gridId: "g1", timeZone: "America/Chicago",
      url: "webcal://cal.test/team.ics", fetchCalendar: async (u) => { asked.push(u); return CAL; },
      resolveSlotLabels: async () => ["9:00am"] });
    expect(asked).toEqual(["https://cal.test/team.ics"]);
    expect(share.type).toBe("ics");
    expect(share.events[0].start.timeSlot).toBe("9:00am");
    expect(share.externalId).toBe("webcal:https://cal.test/team.ics");
  });
  it("a link that is NOT a calendar stays a link", async () => {
    const share = await prepareShare({ userId: "u1", gridId: "g1", url: "https://x.test/page.ics",
      fetchCalendar: async () => "<html>not a calendar</html>" });
    expect(share.type).toBe("link");
  });
  it("an ordinary link is never fetched as a calendar", async () => {
    let asked = 0;
    await prepareShare({ userId: "u1", gridId: "g1", url: "https://x.test/article", fetchCalendar: async () => { asked++; return CAL; } });
    expect(asked).toBe(0);
  });
  it("recognises calendar urls", () => {
    expect(isCalendarUrl("webcal://a.test/x")).toBe(true);
    expect(isCalendarUrl("https://a.test/x.ics?key=1")).toBe(true);
    expect(isCalendarUrl("https://a.test/ics-guide")).toBe(false);
    expect(calendarFetchUrl("webcals://a.test/x.ics")).toBe("https://a.test/x.ics");
  });
});
