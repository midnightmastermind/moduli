// Date-picker selection rules (2026-07-07 audit). classifySelection is the
// single classifier behind NavPickerPopover / DrilldownTimePicker commits —
// these lock the rules discussed with the user: 1 day = single, N consecutive
// = range, N non-consecutive = multi, whole calendar week/month/year = that
// unit (unit survives into the persisted {kind, value, span, dates, unit}
// shape the filter cascade + $activePeriodDates consume).
import { describe, it, expect } from "vitest";
import { classifySelection } from "../ui/NavPickerPopover";

const d = (iso) => new Date(`${iso}T12:00:00`);

describe("classifySelection", () => {
  it("one day → single", () => {
    const r = classifySelection([d("2026-07-07")]);
    expect(r).toMatchObject({ kind: "single", value: "2026-07-07", span: 1 });
  });

  it("consecutive days → range with all dates", () => {
    const r = classifySelection([d("2026-07-07"), d("2026-07-08"), d("2026-07-09")]);
    expect(r.kind).toBe("range");
    expect(r.span).toBe(3);
    expect(r.dates).toEqual(["2026-07-07", "2026-07-08", "2026-07-09"]);
    expect(r.unit).toBe("day");
  });

  it("non-consecutive days → multi keeping every picked date", () => {
    const r = classifySelection([d("2026-07-07"), d("2026-07-10"), d("2026-07-20")]);
    expect(r.kind).toBe("multi");
    expect(r.dates).toEqual(["2026-07-07", "2026-07-10", "2026-07-20"]);
    expect(r.unit).toBe("day");
  });

  it("a whole calendar week → week unit", () => {
    // Sunday-anchored week: 2026-07-05 (Sun) … 2026-07-11 (Sat)
    const days = ["05", "06", "07", "08", "09", "10", "11"].map(x => d(`2026-07-${x}`));
    const r = classifySelection(days);
    expect(r.kind).toBe("week");
    expect(r.span).toBe(7);
    expect(r.unit).toBe("week");
  });

  it("a whole calendar month → month unit", () => {
    const days = [];
    for (let i = 1; i <= 30; i++) days.push(d(`2026-06-${String(i).padStart(2, "0")}`));
    const r = classifySelection(days);
    expect(r).toMatchObject({ kind: "month", unit: "month", span: 30 });
  });

  it("a whole calendar year → year unit", () => {
    const days = [];
    const cur = new Date(2026, 0, 1, 12);
    while (cur.getFullYear() === 2026) { days.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
    const r = classifySelection(days);
    expect(r).toMatchObject({ kind: "year", unit: "year", span: 365 });
  });

  it("order-independence: unsorted input classifies identically", () => {
    const r = classifySelection([d("2026-07-09"), d("2026-07-07"), d("2026-07-08")]);
    expect(r.kind).toBe("range");
    expect(r.value).toBe("2026-07-07");
  });

  it("empty selection → null", () => {
    expect(classifySelection([])).toBeNull();
  });
});
