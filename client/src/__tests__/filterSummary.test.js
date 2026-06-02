import { describe, it, expect } from "vitest";
import { summarizeDays, summarizeSelection } from "../ui/filterSummary";

const D = (n) => `2026-05-${String(n).padStart(2, "0")}`;

describe("summarizeDays", () => {
  it("single day → 'May 6'", () => {
    expect(summarizeDays([D(6)])).toBe("May 6");
  });
  it("contiguous run → 'May 6–9'", () => {
    expect(summarizeDays([D(6), D(7), D(8), D(9)])).toBe("May 6–9");
  });
  it("non-consecutive days → 'May 6, May 9'", () => {
    expect(summarizeDays([D(9), D(6)])).toBe("May 6, May 9");
  });
  it("mixed range + distinct → 'May 6, May 9–12, May 20'", () => {
    expect(summarizeDays([D(6), D(9), D(10), D(11), D(12), D(20)])).toBe("May 6, May 9–12, May 20");
  });
  it("cross-month range", () => {
    expect(summarizeDays(["2026-05-30", "2026-05-31", "2026-06-01", "2026-06-02"])).toBe("May 30–Jun 2");
  });
  it("caps at maxSegments with a '+N more' tail", () => {
    const days = [D(1), D(3), D(5), D(7), D(9)];
    expect(summarizeDays(days, { maxSegments: 2 })).toBe("May 1, May 3 +3 more");
  });
  it("empty → null", () => {
    expect(summarizeDays([])).toBe(null);
  });
});

describe("summarizeSelection", () => {
  it("single value", () => {
    expect(summarizeSelection({ value: D(6), unit: "day", span: 1 })).toBe("May 6");
  });
  it("range via value+span", () => {
    expect(summarizeSelection({ value: D(6), unit: "day", span: 4 })).toBe("May 6–9");
  });
  it("multi via dates[]", () => {
    expect(summarizeSelection({ value: D(6), unit: "day", dates: [D(6), D(9), D(10), D(11)] })).toBe("May 6, May 9–11");
  });
  it("week / month / year render as period labels", () => {
    expect(summarizeSelection({ value: D(6), unit: "week" })).toBe("wk May 6");
    expect(summarizeSelection({ value: D(6), unit: "month" })).toBe("May 2026");
    expect(summarizeSelection({ value: D(6), unit: "year" })).toBe("2026");
  });
});
