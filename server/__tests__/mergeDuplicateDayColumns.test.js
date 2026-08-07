// Guards 0048's two pure selectors. The migration deletes live data, so the
// question each test answers is "could this pick the wrong thing to delete?"
import { describe, it, expect } from "vitest";
import { findDuplicateColumns, collectSubtree } from "../migrations/0048-merge-duplicate-day-columns.mjs";

const col = (id, date, createdAt, extra = {}) => ({
  id, createdAt, fields: { DF: { value: date } }, ...extra,
});

describe("0048 — finding the duplicate day columns", () => {
  it("reports only dates that actually have more than one column", () => {
    const dupes = findDuplicateColumns([
      col("a", "2026-08-03", "2026-08-03T10:00:00Z"),
      col("b", "2026-08-04", "2026-08-04T11:56:00Z"),
      col("c", "2026-08-04", "2026-08-05T02:04:00Z"),
    ]);
    expect(dupes).toHaveLength(1);
    expect(dupes[0].date).toBe("2026-08-04");
  });

  it("KEEPS THE EARLIER column and drops the later one", () => {
    // The load-bearing rule: the first column is the one the build op made;
    // the later one is the duplicate bug's output. Deliberately fed in
    // reverse order so a stable-sort-by-input-order would fail this.
    const dupes = findDuplicateColumns([
      col("later", "2026-08-04", "2026-08-05T02:04:00Z"),
      col("earlier", "2026-08-04", "2026-08-04T11:56:00Z"),
    ]);
    expect(dupes[0].keep.id).toBe("earlier");
    expect(dupes[0].drop.map((d) => d.id)).toEqual(["later"]);
  });

  it("handles three columns for one date — keeps one, drops the rest", () => {
    const dupes = findDuplicateColumns([
      col("c", "2026-08-04", "2026-08-06T00:00:00Z"),
      col("a", "2026-08-04", "2026-08-04T00:00:00Z"),
      col("b", "2026-08-04", "2026-08-05T00:00:00Z"),
    ]);
    expect(dupes[0].keep.id).toBe("a");
    expect(dupes[0].drop.map((d) => d.id)).toEqual(["b", "c"]);
  });

  it("ignores a column carrying no date at all rather than grouping it", () => {
    // A dateless column must never become someone's "duplicate".
    const dupes = findDuplicateColumns([
      { id: "x", createdAt: "2026-08-04T00:00:00Z", fields: {} },
      { id: "y", createdAt: "2026-08-05T00:00:00Z", fields: {} },
    ]);
    expect(dupes).toHaveLength(0);
  });

  it("does not mistake a non-date field value for the date", () => {
    const dupes = findDuplicateColumns([
      { id: "x", createdAt: "2026-08-04T00:00:00Z", fields: { L: { value: "Journal" } } },
      { id: "y", createdAt: "2026-08-05T00:00:00Z", fields: { L: { value: "Notes" } } },
    ]);
    expect(dupes).toHaveLength(0);
  });

  it("a single column for a date is never a duplicate", () => {
    expect(findDuplicateColumns([col("solo", "2026-08-04", "2026-08-04T00:00:00Z")])).toHaveLength(0);
  });
});

describe("0048 — collecting the subtree to delete", () => {
  const world = (pairs) => new Map(pairs.map(([id, kids]) => [id, { id, occurrences: kids }]));

  it("collects the root and every descendant", () => {
    const byId = world([["r", ["a", "b"]], ["a", ["a1"]], ["a1", []], ["b", []]]);
    expect(collectSubtree("r", byId).map((o) => o.id).sort()).toEqual(["a", "a1", "b", "r"]);
  });

  it("terminates on a CYCLE instead of hanging", () => {
    const byId = world([["r", ["a"]], ["a", ["r"]]]);
    expect(collectSubtree("r", byId).map((o) => o.id).sort()).toEqual(["a", "r"]);
  });

  it("skips a child id that names no document, without throwing", () => {
    // Dangling child refs are a documented live-data class; the collector must
    // not die on one, or the migration can never run on a grid that has any.
    const byId = world([["r", ["ghost", "a"]], ["a", []]]);
    expect(collectSubtree("r", byId).map((o) => o.id).sort()).toEqual(["a", "r"]);
  });

  it("returns nothing for a root that does not exist", () => {
    expect(collectSubtree("nope", world([["r", []]]))).toEqual([]);
  });
});
