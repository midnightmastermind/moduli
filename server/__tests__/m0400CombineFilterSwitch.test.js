import { describe, it, expect } from "vitest";
import { withoutPillsStyle } from "../migrations/0400-combine-filter-switch.mjs";

describe("0400 combine filter switch", () => {
  it("drops pills style from the field's filter only", () => {
    const out = withoutPillsStyle([
      { id: "a", fieldId: "fC", style: "pills", active: true },
      { id: "b", fieldId: "fOther", style: "pills" },
    ], "fC");
    expect(out[0]).toEqual({ id: "a", fieldId: "fC", active: true });
    expect(out[1].style).toBe("pills");
  });
  it("returns null when nothing changes", () => {
    expect(withoutPillsStyle([{ id: "a", fieldId: "fC" }], "fC")).toBeNull();
    expect(withoutPillsStyle([{ id: "a", fieldId: "fC", style: "select" }], "fC")).toBeNull();
  });
});
