import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DrilldownTimePicker from "../ui/DrilldownTimePicker";

// Pure render tests for the picker's drill levels. Selection format:
//   day-level item  → "YYYY-MM-DD"
//   hour-level item → "YYYY-MM-DDTHH:00"
//   min-level item  → "YYYY-MM-DDTHH:MM"
// All three can coexist in the emitted array.

describe("DrilldownTimePicker — hour + minute drilldown (#57)", () => {
  it("starts at day level and shows the month grid", () => {
    const { container } = render(<DrilldownTimePicker value={[]} onChange={() => {}} />);
    // Day labels visible at the top of DayGrid (S and S for Sun/Sat — uses getAllByText)
    expect(screen.getAllByText("S").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("M")).toBeTruthy();
    // Title should reference a month name
    expect(container.textContent).toMatch(/January|February|March|April|May|June|July|August|September|October|November|December/);
  });

  it("drill-down chevron walks day → hour → minute", () => {
    const { container } = render(<DrilldownTimePicker value={[]} onChange={() => {}} />);
    const drillDownBtn = container.querySelector('button[title="Zoom in"]');
    expect(drillDownBtn).toBeTruthy();

    // Click once: day → hour
    fireEvent.click(drillDownBtn);
    expect(container.textContent).toMatch(/Hours on /);

    // Click again: hour → minute
    fireEvent.click(drillDownBtn);
    expect(container.textContent).toMatch(/Minutes/);

    // Drill-down at minute is disabled
    expect(drillDownBtn.disabled).toBe(true);
  });

  it("hour-grid click emits an ISO datetime to the hour", () => {
    const onChange = vi.fn();
    const { container } = render(<DrilldownTimePicker value={[]} onChange={onChange} />);

    const drillDown = container.querySelector('button[title="Zoom in"]');
    fireEvent.click(drillDown); // day → hour

    // Find the "9:00am" cell
    const nineAm = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "9:00am");
    expect(nineAm).toBeTruthy();
    fireEvent.click(nineAm);

    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0][0];
    expect(Array.isArray(emitted)).toBe(true);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatch(/^\d{4}-\d{2}-\d{2}T09:00$/);
  });

  it("right-click hour-cell drills into minute grid for that hour", () => {
    const { container } = render(<DrilldownTimePicker value={[]} onChange={() => {}} />);

    const drillDown = container.querySelector('button[title="Zoom in"]');
    fireEvent.click(drillDown); // day → hour

    const twoPm = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "2:00pm");
    expect(twoPm).toBeTruthy();
    fireEvent.contextMenu(twoPm);

    // Now at minute level — title should mention 2:00pm
    expect(container.textContent).toMatch(/Minutes — 2:00pm/);
    // 5-minute slots visible
    expect(Array.from(container.querySelectorAll("button")).some(b => b.textContent === ":05")).toBe(true);
    expect(Array.from(container.querySelectorAll("button")).some(b => b.textContent === ":30")).toBe(true);
  });

  it("zoom-out walks all the way back up to year", () => {
    const { container } = render(<DrilldownTimePicker value={[]} onChange={() => {}} />);

    const drillDown = container.querySelector('button[title="Zoom in"]');
    fireEvent.click(drillDown); // day → hour
    fireEvent.click(drillDown); // hour → minute

    const drillUp = container.querySelector('button[title="Zoom out"]');
    fireEvent.click(drillUp); // minute → hour
    expect(container.textContent).toMatch(/Hours on /);
    fireEvent.click(drillUp); // hour → day
    expect(container.textContent).toMatch(/January|February|March|April|May|June|July|August|September|October|November|December/);
    fireEvent.click(drillUp); // day → week
    expect(container.textContent).toMatch(/Weeks of/);
    fireEvent.click(drillUp); // week → month
    fireEvent.click(drillUp); // month → year
    expect(container.textContent).toMatch(/Years/);
    // Already at top — drillUp button disabled
    const disabledUp = container.querySelector('button[title="Zoom out"]');
    expect(disabledUp.disabled).toBe(true);
  });
});
