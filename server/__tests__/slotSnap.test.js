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

  it("ignores labels that are not times, and sorts what it is given", () => {
    expect(floorToSlot("14:10", ["3:00pm", "Todo", "2:00pm", "1:00pm"])).toBe("2:00pm");
  });
});

// The server twin must read labels EXACTLY as the client's does — the Schedule
// places by the client's reading, so a disagreement would file an event in a
// slot the Schedule then refuses.
import { slotLabelToMinutes } from "../services/slotSnap.js";
import { slotLabelToMinutes as clientSlotLabelToMinutes } from "../../client/src/helpers/slotSpan.js";
describe("slotLabelToMinutes agrees with the client", () => {
  it("over every half-hour label, 24h times, and junk", () => {
    const labels = [];
    for (let h = 0; h < 24; h++) for (const mm of ["00", "30"]) {
      const h12 = h % 12 === 0 ? 12 : h % 12;
      labels.push(`${h12}:${mm}${h < 12 ? "am" : "pm"}`, `${h12}:${mm} ${h < 12 ? "AM" : "PM"}`, `${h}:${mm}`);
    }
    labels.push("12pm", "7am", "", null, "Todo", "25:00", "9:75");
    for (const l of labels) expect(slotLabelToMinutes(l)).toBe(clientSlotLabelToMinutes(l));
  });
});

