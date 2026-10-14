// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { formatFilterValue } from "../ui/HeaderChevron.jsx";

const fields = { cs: { id: "cs", name: "Combine Schedule", type: "boolean" }, d: { id: "d", name: "Date", type: "date" } };
describe("filter pill for a switch filter", () => {
  it("off shows no pill (unset already reads as off)", () => {
    expect(formatFilterValue("cs", false, fields)).toBeNull();
    expect(formatFilterValue("cs", "false", fields)).toBeNull();
  });
  it("on is named by its field, not 'true'", () => {
    expect(formatFilterValue("cs", true, fields)).toBe("Combine Schedule");
  });
  it("a date still formats as a date (control)", () => {
    expect(formatFilterValue("d", "2026-10-14", fields)).toMatch(/Oct 14/);
  });
});
