// The Alarms & Reminders panel shows the current time (user, 2026-09-19), and
// found on the way: every alarm ROW's time rendered blank, because it
// destructured `{ t, ampm }` from formatAlarmTime, which returns a string.
import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { NowClock, AlarmRow } from "../ui/AlarmDropdown.jsx";
import { alarmTimeParts, formatAlarmTime } from "../helpers/alarmOps";

describe("alarm time display", () => {
  it("alarmTimeParts splits what formatAlarmTime joins", () => {
    expect(alarmTimeParts("17:00")).toEqual({ t: "5:00", ampm: "PM" });
    expect(alarmTimeParts("00:05")).toEqual({ t: "12:05", ampm: "AM" });
    expect(alarmTimeParts("bad")).toEqual({ t: "bad", ampm: "" });
    expect(formatAlarmTime("17:00")).toBe("5:00 PM");
  });

  it("the panel shows the current time", () => {
    const { getByTestId } = render(<NowClock now={new Date(2026, 8, 19, 14, 5)} />);
    expect(getByTestId("alarm-now").textContent).toContain("2:05");
    expect(getByTestId("alarm-now").textContent).toContain("PM");
  });

  it("an alarm row shows its time", () => {
    const op = { id: "a", alarm: { type: "alarm", label: "Wake", time: "06:30" }, enabled: true };
    const { container } = render(<AlarmRow op={op} onPatch={() => {}} onDelete={() => {}} />);
    expect(container.textContent).toContain("6:30");
    expect(container.textContent).toContain("AM");
  });
});
