# Share → Import Routing: Calendar (.ics) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Share a calendar invite and have it land as an appointment the Schedule places in the right timeslot.

**Architecture:** A new `services/icsImport.js` parses `VCALENDAR` into a flat event catalogue during **ingress** (before any rule runs), so a rule sees `$share.events[]` and can `LOOP` over it. The rule then `CREATE`s one row per event, **binding** Schedule Type / Date / Time Slot / Duration so `Schedule: Place Dated Work` picks it up.

**Tech Stack:** Node ESM · vitest · an ics parsing library chosen *by test* in Task 1

**Spec:** `docs/superpowers/specs/2026-09-23-share-import-routing-design.md` (§6, D4, D11, D12, D17, D20)

**Depends on:** Plan 1 (`2026-09-23-share-import-routing-engine.md`) — specifically `prepareShare`, `runShareRules`, and the executor's `CREATE` with `bindFields`.

## Progress (updated 2026-09-24)

| task | state |
|---|---|
| 1 parse, timezone-correct | done — `node-ical` 0.27 |
| 2 floor onto slot labels | done |
| 3 wire ics into ingress | done |
| 4 the ics rule + reaching the Schedule | **code proven end to end; the rule itself is data the user authors, and the Schedule check needs prod** |

**Where the code differs from the sketches below:**
- **Library:** node-ical passed every zoned case, including Outlook's WINDOWS zone names ("Central
  Standard Time"). It failed the two ZONELESS cases (floating, all-day): it builds them in the SERVER's
  zone, so `inZone` reads a value with no `tz` back as written. Tests pass with the server in UTC,
  Los Angeles and Tokyo.
- **Slot labels:** ingress runs before any rule, so it cannot read "the destination's slots".
  `services/scheduleSlots.js` reads the grid's own vocabulary: the "Time Slot" field's static options,
  else the distinct time-shaped labels of the grid's occurrences (the slot rows). None → `timeSlot:
  null` and a notice — never a guessed list.
- **Timezone:** nothing stored one. The sender sends `timeZone` (the extension now does); the server
  remembers it in `user.meta.share.timeZone` for senders that cannot. Unknown → each event is read in
  its own invite's zone, with a notice.
- **An edited invite moves its row:** the editor has no externalId box, and the share's own key is the
  file's bytes (which change when an invite is edited). A CREATE inside a LOOP over items that carry an
  `externalId` (events: `ics:<UID>`) is keyed on the ITEM.
- **Notices** (`$share.notices`, shown in Recent shares): recurrence not imported, zone guessed, no
  slots on the grid, no events found.
- `server/__tests__/shareIcsEndToEnd.test.js` shares a real .ics over HTTP through the real engine and
  executor with a rule in the editor's exact shape: SUMMARY → label, 2:17pm → "2:00pm", Date/Duration
  written, **Schedule Type bound with no value**, keyed `ics:<UID>::<step>`; re-sharing an edited
  invite keys the same row.

## Global Constraints

- **`SUMMARY` → the row's LABEL** (D4). Not the Schedule Type.
- **Time floors to the slot it falls inside** (D11). 2:17pm → `"2:00pm"`; 2:55pm → `"2:30pm"`. Never rounds an event earlier than it starts.
- **Recurring events import the first occurrence only** (D12), set `recurring: true`, and report *"recurrence not imported"*. `RRULE` expansion is out of scope.
- **No cap on events in one file** (D20). A shared subscription writes one row per event, possibly hundreds. The log's count is the only warning the design offers — do not add a cap without a new decision.
- **The `CREATE` must BIND all four fields** (D17), Schedule Type with no value. Ops gate on `_boundFieldIds`; a row with values and no bindings is invisible to the Schedule.
- **Slot labels are DATA**, read from the destination's own slots — never a hardcoded list.
- **Server tests:** `cd server && npx vitest run <path>`.
- **A/B every behavioural fix** and assert the mutation landed.

---

## File Structure

**Created**

| file | responsibility |
|---|---|
| `server/services/icsImport.js` | `VCALENDAR` text → the flat event catalogue in spec §3. Pure apart from the parser dependency. |
| `server/services/slotSnap.js` | `floorToSlot(time, slotLabels)` — the one place a time becomes a slot label. |
| `server/__tests__/icsImport.test.js` | |
| `server/__tests__/slotSnap.test.js` | |

**Modified**

| file | change |
|---|---|
| `server/services/shareIngress.js` | An `ics` branch that parses the file into `$share.events`. |
| `server/package.json` | The parser dependency chosen in Task 1. |

---

## Task 1: Parse a calendar, correctly across timezones

**The dependency is chosen BY TEST.** Timezones are the correctness trap here (spec §6): `DTSTART` may carry a `TZID`, be UTC (`Z`-suffixed), or be floating. Get it wrong and an evening event lands on the wrong day. So the tests come first and the library that passes them is the one we take.

**Files:**
- Create: `server/services/icsImport.js`
- Create: `server/__tests__/icsImport.test.js`
- Modify: `server/package.json`

**Interfaces:**
- Produces: `parseIcs(text, { timeZone }) → { events: [...], skipped: number }` where each event is
  `{ summary, start: { date, time, timeSlot: null }, end: { date, time }, durationMin, allDay, location, description, organizer, uid, recurring }`.
  `timeSlot` is filled later by Task 2 — the parser does not know about slots.

- [ ] **Step 1: Write the failing test (these are the acceptance criteria for the library)**

```js
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
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run __tests__/icsImport.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Install the candidate parser**

Start with `node-ical` — it returns plain JS objects (rather than an ICAL component tree), which keeps `icsImport.js` thin.

```bash
cd server && npm install node-ical
```

**If the TZID or the UTC test fails, swap to `ical.js`** (Mozilla's, with its own timezone registry) and keep the tests unchanged. The tests are the contract; the library is an implementation detail. Record which one you took and why in the commit.

- [ ] **Step 4: Implement**

```js
// server/services/icsImport.js
//
// VCALENDAR → the flat event catalogue in spec §3.
//
// TIMEZONES ARE THE CORRECTNESS TRAP. DTSTART arrives in three forms —
// TZID-qualified, UTC (Z-suffixed), or floating — and each resolves to a
// different local day. Every one has its own test; the library was chosen by
// passing them.
//
// RECURRENCE IS NOT EXPANDED (D12). The first occurrence is imported and
// `recurring` is set, so the caller can say "recurrence not imported" rather
// than silently producing one row where fifty were expected.
import ical from "node-ical";

const pad = (n) => String(n).padStart(2, "0");

/** A Date → { date: "YYYY-MM-DD", time: "HH:MM" } in the USER'S zone. */
function inZone(d, timeZone) {
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
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd server && npx vitest run __tests__/icsImport.test.js`
Expected: PASS (9 tests)

- [ ] **Step 6: Commit**

```bash
git add server/services/icsImport.js server/__tests__/icsImport.test.js server/package.json server/package-lock.json
git commit -m "feat(ics): parse VCALENDAR into a flat event catalogue, timezone-correct"
```

---

## Task 2: Floor a time onto a slot label

**Files:**
- Create: `server/services/slotSnap.js`
- Create: `server/__tests__/slotSnap.test.js`

**Interfaces:**
- Produces: `floorToSlot(time, slotLabels) → string | null`. `time` is `"HH:MM"`; `slotLabels` is the destination's own labels (`["6:00am", "6:30am", …]`).

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/slotSnap.test.js
//
// D11 — FLOOR, not nearest. An event is placed in the slot it is actually
// inside; snapping to nearest would move a 2:55 start to 3:00, i.e. EARLIER
// than the event begins is impossible but LATER is — and a slot you have
// already passed reads as a missed appointment.
//
// Slot labels are DATA (the destination's own), never a hardcoded list.
import { describe, it, expect } from "vitest";
import { floorToSlot } from "../services/slotSnap.js";

const SLOTS = ["1:00pm", "1:30pm", "2:00pm", "2:30pm", "3:00pm"];

describe("floorToSlot", () => {
  it("an exact match takes its own slot", () => {
    expect(floorToSlot("14:00", SLOTS)).toBe("2:00pm");
  });

  it("2:17pm floors to 2:00pm, not 2:30pm", () => {
    expect(floorToSlot("14:17", SLOTS)).toBe("2:00pm");
  });

  it("2:55pm floors to 2:30pm, not 3:00pm", () => {
    expect(floorToSlot("14:55", SLOTS)).toBe("2:30pm");
  });

  it("2:29pm and 2:30pm land on either side of the boundary", () => {
    expect(floorToSlot("14:29", SLOTS)).toBe("2:00pm");
    expect(floorToSlot("14:30", SLOTS)).toBe("2:30pm");
  });

  it("before the first slot returns the FIRST, not null", () => {
    // An 8am event on a board whose slots start at 1pm belongs at the top,
    // not nowhere.
    expect(floorToSlot("08:00", SLOTS)).toBe("1:00pm");
  });

  it("after the last slot returns the LAST", () => {
    expect(floorToSlot("23:00", SLOTS)).toBe("3:00pm");
  });

  it("reads the labels it is GIVEN — 15-minute slots work unchanged", () => {
    const quarter = ["9:00am", "9:15am", "9:30am", "9:45am"];
    expect(floorToSlot("09:20", quarter)).toBe("9:15am");
  });

  it("handles 12am/12pm without wrapping", () => {
    const edge = ["12:00am", "11:30am", "12:00pm", "11:30pm"];
    expect(floorToSlot("00:10", edge)).toBe("12:00am");
    expect(floorToSlot("12:10", edge)).toBe("12:00pm");
  });

  it("returns null for no slots or no time, rather than guessing", () => {
    expect(floorToSlot("14:00", [])).toBe(null);
    expect(floorToSlot(null, SLOTS)).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run __tests__/slotSnap.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// server/services/slotSnap.js
//
// The ONE place a time becomes a slot label (D11: FLOOR, not nearest).
//
// The labels come from the destination's own slots — the Schedule's slot
// vocabulary is data, and a hardcoded list would break the moment a board uses
// 15-minute slots. `helpers/timeslotPassed.js` records the same parsing job on
// the client; this is its server twin and the am/pm edge cases are why it has
// its own tests.
export function parseSlotLabel(label) {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(String(label || "").trim());
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/pm/i.test(m[3])) h += 12;
  return h * 60 + Number(m[2]);
}

export function floorToSlot(time, slotLabels = []) {
  if (!time || !slotLabels.length) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time).trim());
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);

  const parsed = slotLabels
    .map((label) => ({ label, mins: parseSlotLabel(label) }))
    .filter((s) => s.mins != null)
    .sort((a, b) => a.mins - b.mins);
  if (!parsed.length) return null;

  // Before the first slot, the top of the board is where it belongs —
  // returning null would drop the event instead of placing it.
  if (mins < parsed[0].mins) return parsed[0].label;

  let best = parsed[0];
  for (const s of parsed) { if (s.mins <= mins) best = s; else break; }
  return best.label;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd server && npx vitest run __tests__/slotSnap.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: A/B — prove FLOOR is what the tests pin**

```bash
cd /home/joshpoms/moduli && cp server/services/slotSnap.js /tmp/SS.keep
python3 - <<'PY'
import io
p="server/services/slotSnap.js"; s=io.open(p).read()
s = s.replace("""  let best = parsed[0];
  for (const s of parsed) { if (s.mins <= mins) best = s; else break; }
  return best.label;""",
"""  let best = parsed[0];
  for (const s of parsed) if (Math.abs(s.mins - mins) < Math.abs(best.mins - mins)) best = s;
  return best.label;""")   # NEAREST instead of FLOOR
io.open(p,"w").write(s)
PY
echo "floor present = $(grep -c 's.mins <= mins' server/services/slotSnap.js) (0 = mutation landed)"
cd server && npx vitest run __tests__/slotSnap.test.js 2>&1 | grep -E "Tests "
cd .. && cp /tmp/SS.keep server/services/slotSnap.js
```
Expected: the 2:17 and 2:55 cases fail under "nearest". The exact-match and edge cases pass in both arms — **report those as contract pins, not coverage.**

- [ ] **Step 6: Commit**

```bash
git add server/services/slotSnap.js server/__tests__/slotSnap.test.js
git commit -m "feat(ics): floor a time onto the destination's own slot labels"
```

---

## Task 3: Wire ics into ingress

**Files:**
- Modify: `server/services/shareIngress.js`
- Modify: `server/__tests__/apiShare.test.js`

**Interfaces:**
- Consumes: `parseIcs` (Task 1), `floorToSlot` (Task 2).
- Produces: `$share.events[]` with `start.timeSlot` filled, plus `$share.notices[]`.

- [ ] **Step 1: Write the failing test**

```js
describe("ics ingress", () => {
  it("exposes events on $share so a rule can LOOP them", async () => {
    const share = await prepareShare({
      userId: "u1", gridId: "g1", source: "android", timeZone: "America/Chicago",
      files: [{ filename: "m.ics", mimetype: "text/calendar", size: 100,
                text: `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Dentist\r\n` +
                      `DTSTART;TZID=America/Chicago:20260925T141700\r\n` +
                      `DTEND;TZID=America/Chicago:20260925T151700\r\nEND:VEVENT\r\nEND:VCALENDAR` }],
      slotLabels: ["2:00pm", "2:30pm"],
    });
    expect(share.type).toBe("ics");
    expect(share.events).toHaveLength(1);
    expect(share.events[0].summary).toBe("Dentist");
    expect(share.events[0].start.timeSlot).toBe("2:00pm");   // FLOORED (D11)
    expect(share.events[0].durationMin).toBe(60);
  });

  it("gives each event its OWN externalId from the UID, so re-sharing updates", async () => {
    const share = await prepareShare({ /* …two VEVENTs, UIDs a and b… */ });
    expect(share.events.map(e => e.externalId)).toEqual(["ics:a", "ics:b"]);
  });

  it("reports recurrence rather than silently importing one of fifty (D12)", async () => {
    const share = await prepareShare({ /* …one VEVENT with RRULE… */ });
    expect(share.notices).toContain("recurrence not imported");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npx vitest run __tests__/apiShare.test.js -t ics`
Expected: FAIL — `share.events` undefined.

- [ ] **Step 3: Implement the ingress branch**

In `prepareShare`, after classification:

```js
  if (type === "ics") {
    const text = files[0].text ?? await readFile(files[0].path, "utf8");
    const { events } = parseIcs(text, { timeZone });
    const withSlots = events.map((e) => ({
      ...e,
      start: { ...e.start, timeSlot: floorToSlot(e.start.time, slotLabels) },
      // Each EVENT carries its own identity — one .ics can hold many rows, and
      // each must dedup independently on re-share (spec §7).
      externalId: e.uid ? `ics:${e.uid}` : `ics:${e.summary}:${e.start.date}`,
    }));
    const notices = withSlots.some((e) => e.recurring) ? ["recurrence not imported"] : [];
    return { type, source, props: enriched, events: withSlots, notices,
             externalId: null, receivedAt: new Date().toISOString() };
  }
```

`slotLabels` are read from the rule's destination before the rule runs — the destination's own slot children, never a constant.

- [ ] **Step 4: Run to verify it passes** · **Step 5: Commit**

```bash
git add server/services/shareIngress.js server/__tests__/apiShare.test.js
git commit -m "feat(ics): ingress parses the calendar so a rule can LOOP its events"
```

---

## Task 4: The shipped ics rule, and proving it reaches the Schedule

This is **data, not code** — a rule authored through the Imports tab (D19). The test is that a shared invite appears on the Schedule.

**Files:** none. This task is performed through the UI and verified in Mongo.

- [ ] **Step 1: Author the rule in the Imports tab**

```
On Share · type = ics
  LOOP $share.events as $e
    CREATE instance in <Appointments>
      label       = $e.summary
      externalId  = $e.externalId
      fields      : Date = $e.start.date
                    Time Slot = $e.start.timeSlot
                    Duration = $e.durationMin
      bindFields  : [Schedule Type, Date, Time Slot, Duration]
```

**`bindFields` must include Schedule Type with no value** (D17). `Schedule: Place Dated Work` gates on `_boundFieldIds ARRAY_INCLUDES <Schedule Type>` — the binding, not the value. Without it the row is invisible to the Schedule while looking perfect in Mongo.

- [ ] **Step 2: Share a single-event invite and read the row back**

Post a one-event `.ics` to `/api/v1/share` with a Bearer token, then in Mongo confirm the created occurrence has: the right `label`, `Date`/`Time Slot`/`Duration` values, and **four entries in its module's `fieldBindings`** including Schedule Type.

- [ ] **Step 3: Confirm it reaches the SCHEDULE — the thing that actually matters**

Open the grid on the event's date and confirm the row appears in the floored timeslot. This is the acceptance criterion for the whole plan; a row in Appointments that never reaches the Schedule is a failure even though every unit test passes.

- [ ] **Step 4: Confirm idempotency by doing it twice**

Share the **same** invite again. Expected: **one** row, updated — not two. Then share an **edited** version (changed time) and confirm the same row moves.

- [ ] **Step 5: Record the result**

```bash
git commit --allow-empty -m "verify(ics): a shared invite lands in its timeslot

<paste the before/after Mongo reads and what the Schedule showed>"
```

---

## Self-Review

**Spec coverage.** §6 parse → Task 1 · D11 flooring → Task 2 · D12 recurrence → Tasks 1, 3 · D20 no cap → Task 1 · §3 catalogue + §7 per-event externalId → Task 3 · D4 SUMMARY→label and D17 bindings → Task 4.

**Placeholders.** None. Task 3's test bodies elide two fixture strings with `/* … */` inside otherwise-complete tests — the fixture shape is fully shown in Task 1's tests and the assertions are explicit.

**Type consistency.** `parseIcs` returns `{ events, skipped }` (Task 1), consumed as `.events` in Task 3. Each event's `start.timeSlot` is `null` from the parser and filled by `floorToSlot(time, slotLabels)` (Task 2) in Task 3. `floorToSlot` takes `"HH:MM"`, which is exactly what `start.time` holds.

**Risk.** Task 1's library choice is decided by the timezone tests. If neither `node-ical` nor `ical.js` passes the TZID case, that is a finding worth reporting rather than working around — a calendar importer that files events on the wrong day is worse than none.
