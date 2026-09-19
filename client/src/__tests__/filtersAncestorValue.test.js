// The Filters dropdown's Ancestor Filters row printed a date range as
// "Date = [object Object]" (Day Page, 2026-09-19) while the nav chip above it
// read "Sep 19–21". Both now go through FilterNavWidgets.formatFilterValueLabel.
import { describe, it, expect } from "vitest";
import { _formatValueForTests as formatValue } from "../ui/FiltersSection";
import { formatFilterValueLabel } from "../ui/FilterNavWidgets";

// The exact value on the live Day Page's filterOverride.
const RANGE = { value: "2026-09-19", unit: "day", span: 3, kind: "range" };

describe("ancestor filter value", () => {
  it("a range object reads as the chip reads it, never [object Object]", () => {
    const shown = formatValue(RANGE);
    expect(shown).not.toMatch(/object Object/);
    expect(shown).toBe(formatFilterValueLabel(RANGE));
    expect(shown).toMatch(/19/);
    expect(shown).toMatch(/21/);
  });

  it("a single-day object reads as that day", () => {
    const shown = formatValue({ value: "2026-09-19", unit: "day", span: 1, kind: "single" });
    expect(shown).toMatch(/Sep/);
    expect(shown).toMatch(/19/);
  });

  it("controls: plain values are unchanged", () => {
    expect(formatValue(null)).toBe("—");
    expect(formatValue("2026-09-19")).toBe(new Date(2026, 8, 19).toLocaleDateString());
    expect(formatValue(["a", "b"])).toBe("a, b");
    expect(formatValue("Todo")).toBe("Todo");
  });
});
