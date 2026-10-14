// The first tab of the when picker holds SEVERAL dates (user, 2026-10-14: "it shouldnt say once … you can select
// multiple dates"). Stored as { mode: "once", dates: [...], time }; an older single `date` still reads.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { onceDates, isWhen, whenTimesOnDay, describeWhen, nextFireAfter } from "../helpers/when.js";
import WhenPicker from "../ui/WhenPicker.jsx";

describe("once with several dates", () => {
  const v = { mode: "once", dates: ["2026-10-15", "2026-10-13"], time: "14:30" };
  it("falls on each of its dates and no other", () => {
    expect(whenTimesOnDay(v, "2026-10-13")).toEqual(["14:30"]);
    expect(whenTimesOnDay(v, "2026-10-15")).toEqual(["14:30"]);
    expect(whenTimesOnDay(v, "2026-10-14")).toEqual([]);
  });
  it("reads an older single date too", () => {
    const old = { mode: "once", date: "2026-10-13" };
    expect(isWhen(old)).toBe(true);
    expect(onceDates(old)).toEqual(["2026-10-13"]);
    expect(whenTimesOnDay(old, "2026-10-13")).toEqual([null]);
  });
  it("is not usable with no dates", () => {
    expect(isWhen({ mode: "once", dates: [] })).toBe(false);
  });
  it("describes several dates", () => {
    expect(describeWhen(v)).toMatch(/Oct 13, Oct 15 at 2:30pm/);
    expect(describeWhen({ mode: "once", dates: ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"] })).toMatch(/Oct 13 \+ 3 more dates/);
  });
  it("has a next fire after the first date rang (so a reminder is not spent yet)", () => {
    const after = new Date(2026, 9, 13, 14, 31);
    expect(nextFireAfter(v, after)?.getDate()).toBe(15);
    expect(nextFireAfter(v, new Date(2026, 9, 15, 14, 31))).toBe(null);
  });
});

describe("WhenPicker Dates tab", () => {
  it("is labelled Dates, adds a date and saves them all", () => {
    const onSave = vi.fn();
    render(<WhenPicker value={{ mode: "once", date: "2026-10-13", time: "09:00" }} onSave={onSave} />);
    expect(screen.getByRole("tab", { name: "Dates" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Once" })).toBeNull();
    fireEvent.click(screen.getByText("+ date"));
    expect(screen.getByLabelText("Date 2").value).toBe("2026-10-14");
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({ mode: "once", dates: ["2026-10-13", "2026-10-14"], time: "09:00" });
  });
  it("removes a date", () => {
    const onSave = vi.fn();
    render(<WhenPicker value={{ mode: "once", dates: ["2026-10-13", "2026-10-20"] }} onSave={onSave} />);
    fireEvent.click(screen.getByLabelText("Remove date 1"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0][0].dates).toEqual(["2026-10-20"]);
  });
});
