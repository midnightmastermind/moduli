// An appointment occupies every slot it covers (user, 2026-08-07).
//
// MEASURED BEFORE WRITING: poms grid's `Time Slot` is 48 half-hour options
// ("12:00am" … "11:30pm") and `Duration` is a real duration field the
// Appointment action already binds — so start + length IS the span and no new
// field is needed. The fixture below is those 48 labels.

import { describe, it, expect } from "vitest";
import { slotsCovered, slotLabelToMinutes, describeSpan, formatMinutes } from "../helpers/slotSpan.js";

// The grid's own 48, built the way the seed does.
const SLOTS = Array.from({ length: 48 }, (_, i) => {
  const h24 = Math.floor(i / 2), m = i % 2 ? 30 : 0;
  const mer = h24 < 12 ? "am" : "pm";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, "0")}${mer}`;
});

describe("slotLabelToMinutes", () => {
  it("parses the grid's own label form", () => {
    expect(slotLabelToMinutes("12:00am")).toBe(0);
    expect(slotLabelToMinutes("2:00pm")).toBe(840);
    expect(slotLabelToMinutes("11:30pm")).toBe(1410);
    expect(slotLabelToMinutes("12:00pm")).toBe(720); // noon, not midnight
    expect(slotLabelToMinutes("12:30am")).toBe(30);
  });

  it("also accepts 24-hour, which is what an alarm carries", () => {
    expect(slotLabelToMinutes("14:00")).toBe(840);
    expect(slotLabelToMinutes("00:30")).toBe(30);
  });

  it("returns null for junk rather than guessing a time", () => {
    for (const j of ["", null, undefined, "soon", "25:00", "2:99"]) {
      expect(slotLabelToMinutes(j)).toBeNull();
    }
  });
});

describe("slotsCovered — the user's real appointments", () => {
  it("Therapy 2:00pm for 60 min covers 2:00 and 2:30", () => {
    expect(slotsCovered("2:00pm", 60, SLOTS)).toEqual(["2:00pm", "2:30pm"]);
  });

  it("Therapy 1:00pm for 60 min covers 1:00 and 1:30", () => {
    expect(slotsCovered("1:00pm", 60, SLOTS)).toEqual(["1:00pm", "1:30pm"]);
  });

  it("Peer Support 6:00pm for 120 min covers four slots", () => {
    expect(slotsCovered("6:00pm", 120, SLOTS))
      .toEqual(["6:00pm", "6:30pm", "7:00pm", "7:30pm"]);
  });
});

describe("slotsCovered — the interval is HALF-OPEN, and that is the point", () => {
  it("an appointment ending at 3:00 does NOT occupy the 3:00 slot", () => {
    // The 3:00 slot is free from 3:00. A closed interval would make every
    // back-to-back pair collide, and the day would read as double-booked.
    expect(slotsCovered("2:00pm", 60, SLOTS)).not.toContain("3:00pm");
  });

  it("so two back-to-back appointments do not overlap", () => {
    const a = slotsCovered("2:00pm", 60, SLOTS);
    const b = slotsCovered("3:00pm", 60, SLOTS);
    expect(a.filter((s) => b.includes(s))).toEqual([]);
  });

  it("a 30-minute appointment occupies exactly one slot", () => {
    expect(slotsCovered("2:00pm", 30, SLOTS)).toEqual(["2:00pm"]);
  });

  it("a 45-minute appointment still occupies both slots it touches", () => {
    // It runs into 2:30–3:00, so that slot is genuinely busy.
    expect(slotsCovered("2:00pm", 45, SLOTS)).toEqual(["2:00pm", "2:30pm"]);
  });
});

describe("slotsCovered — the refusals", () => {
  it("an unknown duration still lands the appointment in its START slot", () => {
    // "We do not know how long" is not "it occupies nothing". An appointment
    // that lands nowhere is worse than one that lands once.
    for (const d of [0, null, undefined, "", NaN, -30]) {
      expect(slotsCovered("2:00pm", d, SLOTS)).toEqual(["2:00pm"]);
    }
  });

  it("REFUSES a start time the grid has no slot for, rather than rounding", () => {
    // Rounding 2:15 to 2:00 silently moves someone's appointment. The caller
    // must see that the time does not fit the day's grid.
    expect(slotsCovered("2:15pm", 60, SLOTS)).toEqual([]);
  });

  it("does not run past the end of the day", () => {
    expect(slotsCovered("11:00pm", 180, SLOTS)).toEqual(["11:00pm", "11:30pm"]);
  });

  it("returns nothing without a start or without slots", () => {
    expect(slotsCovered(null, 60, SLOTS)).toEqual([]);
    expect(slotsCovered("2:00pm", 60, [])).toEqual([]);
  });

  it("sorts by the CLOCK even when the options arrive unsorted", () => {
    // The result is what gets rendered in a day column, so its order matters
    // regardless of how the caller held the options.
    const shuffled = [...SLOTS].reverse();
    expect(slotsCovered("2:00pm", 60, shuffled)).toEqual(["2:00pm", "2:30pm"]);
  });
});

describe("describeSpan", () => {
  it("reads as a range in the grid's own vocabulary", () => {
    expect(describeSpan("2:00pm", 60, SLOTS)).toBe("2:00pm–3:00pm");
    expect(describeSpan("6:00pm", 120, SLOTS)).toBe("6:00pm–8:00pm");
  });

  it("formats an end that is not on a slot boundary", () => {
    expect(describeSpan("2:00pm", 45, SLOTS)).toBe("2:00pm–2:45pm");
  });

  it("falls back to just the start when the length is unknown", () => {
    expect(describeSpan("2:00pm", 0, SLOTS)).toBe("2:00pm");
  });
});

describe("formatMinutes", () => {
  it("uses 12 rather than 0 at both noon and midnight", () => {
    expect(formatMinutes(0)).toBe("12:00am");
    expect(formatMinutes(720)).toBe("12:00pm");
  });

  it("wraps past midnight instead of producing a 25th hour", () => {
    expect(formatMinutes(24 * 60 + 30)).toBe("12:30am");
  });
});
