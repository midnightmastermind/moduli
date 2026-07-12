import { describe, it, expect } from "vitest";
import {
  buildAlarmOperation, applyAlarmToOperation, listAlarmOperations, formatAlarmTime,
} from "../helpers/alarmOps";

describe("alarmOps", () => {
  it("formats HH:MM to Android-style 12h", () => {
    expect(formatAlarmTime("17:00")).toBe("5:00 PM");
    expect(formatAlarmTime("00:05")).toBe("12:05 AM");
    expect(formatAlarmTime("12:30")).toBe("12:30 PM");
    expect(formatAlarmTime("08:00")).toBe("8:00 AM");
  });

  it("buildAlarmOperation mints a scheduler-ready atTimes op with a ringing NOTIFY", () => {
    const op = buildAlarmOperation({ gridId: "g1", type: "alarm", label: "5 PM", time: "17:00" });
    expect(op.alarm).toEqual({ type: "alarm", label: "5 PM", time: "17:00" });
    expect(op.schedule).toMatchObject({ kind: "atTimes", times: ["17:00"], lastFiredAt: null });
    expect(op.triggerObjects).toEqual([]); // schedule and triggers are mutually exclusive
    expect(op.name).toBe("Alarm: 5 PM");
    const step = op.pipeline.steps[0];
    expect(step.config.type).toBe("NOTIFY");
    expect(step.config.sound).toBe(true);
    expect(step.config.message).toContain("5:00 PM");
  });

  it("reminders notify without sound", () => {
    const op = buildAlarmOperation({ gridId: "g1", type: "reminder", label: "Stretch", time: "09:30" });
    expect(op.pipeline.steps[0].config.sound).toBe(false);
    expect(op.name).toBe("Reminder: Stretch");
  });

  it("applyAlarmToOperation re-derives name/schedule/pipeline and resets lastFiredAt only on a time change", () => {
    const op = { ...buildAlarmOperation({ gridId: "g1", type: "alarm", label: "5 PM", time: "17:00" }) };
    op.schedule.lastFiredAt = "2026-07-11T17:00:01Z";
    const relabeled = applyAlarmToOperation(op, { label: "Dinner" });
    expect(relabeled.name).toBe("Alarm: Dinner");
    expect(relabeled.schedule.lastFiredAt).toBe("2026-07-11T17:00:01Z"); // label edit keeps the stamp
    const moved = applyAlarmToOperation(op, { time: "18:00" });
    expect(moved.schedule.times).toEqual(["18:00"]);
    expect(moved.schedule.lastFiredAt).toBe(null); // moved alarm can fire at its new time today
    expect(moved.pipeline.steps[0].config.message).toContain("6:00 PM");
  });

  it("type switch flips the ring + disabling persists through applyAlarmToOperation", () => {
    const op = buildAlarmOperation({ gridId: "g1", type: "alarm", label: "X", time: "07:00" });
    const silent = applyAlarmToOperation(op, { type: "reminder" });
    expect(silent.pipeline.steps[0].config.sound).toBe(false);
    const off = applyAlarmToOperation(op, { enabled: false });
    expect(off.enabled).toBe(false);
  });

  it("listAlarmOperations returns only alarm-managed ops for the grid, time-sorted", () => {
    const a = buildAlarmOperation({ id: "a", gridId: "g1", time: "17:00" });
    const b = buildAlarmOperation({ id: "b", gridId: "g1", time: "08:00" });
    const other = { id: "c", gridId: "g1", name: "Tracker" };
    const wrongGrid = buildAlarmOperation({ id: "d", gridId: "g2", time: "01:00" });
    const list = listAlarmOperations({ a, b, c: other, d: wrongGrid }, "g1");
    expect(list.map((o) => o.id)).toEqual(["b", "a"]);
  });
});
