// A date cleared through its chip stores "" (the native date input's empty value). The filter's
// persistent rule only skipped null, so "" counted as a date that matches no day and the row
// vanished from EVERY day — clearing a date read as deleting the row.
import { describe, it, expect } from "vitest";
import { isOccurrenceVisible } from "../state/selectors.js";

const F = "date-field";
const day = { [F]: { value: "2026-10-09", unit: "day", kind: "single" } };
const conds = [{ fieldId: F, comparator: "SAME_DAY" }];
const occ = (value) => ({ id: "o", fields: value === undefined ? {} : { [F]: { value, flow: "in" } } });

describe("a cleared date is no date", () => {
  it("control: a row dated another day is hidden", () => {
    expect(isOccurrenceVisible(occ("2026-09-27"), day, conds)).toBe(false);
  });
  it("control: a row with no date passes (persistent)", () => {
    expect(isOccurrenceVisible(occ(undefined), day, conds)).toBe(true);
  });
  it("a row whose date was cleared to \"\" passes like an undated row", () => {
    expect(isOccurrenceVisible(occ(""), day, conds)).toBe(true);
  });
  it("the legacy no-conditions path agrees", () => {
    expect(isOccurrenceVisible(occ(""), { [F]: "2026-10-09" })).toBe(true);
    expect(isOccurrenceVisible(occ("2026-09-27"), { [F]: "2026-10-09" })).toBe(false);
  });
});
