// Verifies the STORED guard (read back from poms grid after 0069) against the
// three shapes that are live on the grid today. Pinned as a fixture rather than
// a DB read so it runs anywhere; the shapes were measured on 2026-08-11.
import { describe, it, expect } from "vitest";
import { evalGroup } from "../helpers/operationActions";

const FID = "Eh7oi4HKdbHB";
// Exactly what `runMigrations --apply` wrote, transcribed from the stored op.
const STORED_GUARD = { operator: "AND", rules: [
  { id: "g", left: `$pg.filterOverride.${FID}`, comparator: "IS_NOT_EMPTY", right: "" },
  { id: "or", operator: "OR", rules: [
    { id: "a", left: `$pg.filterOverride.${FID}.value`, comparator: "IS_NOT_EMPTY", right: "" },
    { id: "b", left: `$pg.filterOverride.${FID}.unit`,  comparator: "IS_EMPTY",     right: "" },
    { id: "c", left: `$pg.filterOverride.${FID}.dates`, comparator: "IS_NOT_EMPTY", right: "" },
  ]},
]};
const page = (v) => ({ $pg: { filterOverride: { [FID]: v } } });

describe("the STORED snap guard, against poms grid's live page shapes", () => {
  it("Trackers — a bare date string — still moves forward", () => {
    expect(evalGroup(STORED_GUARD, page("2026-08-10"))).toBe(true);
  });

  it("Schedule — a 2-day RANGE — still moves forward (and $today collapses it)", () => {
    expect(evalGroup(STORED_GUARD, page({ value: "2026-08-10", unit: "day", span: 2, kind: "range" }))).toBe(true);
  });

  it("Day Page — an explicitly CLEARED date — is left alone", () => {
    expect(evalGroup(STORED_GUARD, page({ value: null, unit: "day", kind: "single" }))).toBe(false);
  });

  it("a page with no override at all is still skipped", () => {
    expect(evalGroup(STORED_GUARD, { $pg: { filterOverride: {} } })).toBe(false);
  });

  it("a multi-pick with a null anchor but real dates keeps moving forward", () => {
    expect(evalGroup(STORED_GUARD, page({ value: null, unit: "day", kind: "multi", dates: ["2026-08-10"] }))).toBe(true);
  });
});
