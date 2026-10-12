// A trigger storing a hidden alias (poms' "Schedule: Stamp Date & Time Slot" stored onCreate) rendered as the
// FIRST option — "On Change" — because a <select> cannot show a value it does not offer. Found 2026-10-11.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { eventOptions, VISIBLE_EVENT_TYPES } from "../helpers/triggerTypes.js";

describe("eventOptions", () => {
  it("a stored hidden alias gets its own entry", () => {
    expect(eventOptions("onCreate").map((e) => e.value)).toContain("onCreate");
  });
  it("control: a visible event leaves the list as it is", () => {
    expect(eventOptions("onAdd")).toEqual(VISIBLE_EVENT_TYPES);
    expect(eventOptions(undefined)).toEqual(VISIBLE_EVENT_TYPES);
  });
  it("the trigger editor's event select uses it", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../ui/commandCenter/OperationsTab.jsx"), "utf8");
    expect(src).toMatch(/eventOptions\(eventType\)\.map/);
  });
});
