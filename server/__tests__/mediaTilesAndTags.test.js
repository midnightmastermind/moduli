import { describe, it, expect } from "vitest";
import { MEDIA_TAGS, TILE_LAYOUT, TILE_BOARDS, allTagOptions, mergeTileLayout, planTagWrites }
  from "../migrations/0237-media-tiles-and-tags.mjs";

const row = (id, label, tagFieldId, cur) => ({
  id, label, fields: cur === undefined ? {} : { [tagFieldId]: { value: cur, flow: "in" } },
});

describe("0237 — the tile shape", () => {
  it("is wrap + column — the same arrangement the tracker tiles use", () => {
    expect(TILE_LAYOUT).toEqual({ mode: "wrap", childContentDirection: "column" });
  });

  // A board carries other cascade keys (childMinWidth, sortChildrenByField…).
  // Replacing the object wholesale would silently drop them.
  it("MERGES onto a stored layout rather than replacing it", () => {
    const out = mergeTileLayout({ childMinWidth: 184, sortChildrenByField: "f1" });
    expect(out).toEqual({ childMinWidth: 184, sortChildrenByField: "f1", mode: "wrap", childContentDirection: "column" });
  });

  it("handles a board with no stored layout at all", () => {
    expect(mergeTileLayout(null)).toEqual(TILE_LAYOUT);
  });

  // The boards with artwork, and ONLY those. The Library board is excluded on
  // purpose — it holds 117 reflection questions beside its movies.
  it("does not tile the Library board", () => {
    expect(TILE_BOARDS.map(([id]) => id)).not.toContain("VI5z1eAPtFg5");
  });
});

describe("0237 — tag options", () => {
  it("are the distinct authored values, sorted", () => {
    const o = allTagOptions();
    expect(o).toEqual([...new Set(o)]);
    expect([...o].sort()).toEqual(o);
    expect(o).toContain("sci-fi");
    expect(o).toContain("stoicism");
  });

  it("every authored entry is a non-empty array of strings", () => {
    for (const [title, tags] of Object.entries(MEDIA_TAGS)) {
      expect(Array.isArray(tags), title).toBe(true);
      expect(tags.length, title).toBeGreaterThan(0);
      for (const t of tags) expect(typeof t, title).toBe("string");
    }
  });
});

describe("0237 — planTagWrites", () => {
  const F = "tag1";

  it("writes the authored tags for a matched, untagged row", () => {
    const { writes } = planTagWrites([row("o1", "Inception", F)], F);
    expect(writes).toEqual([{ id: "o1", label: "Inception", tags: ["sci-fi", "thriller"] }]);
  });

  // The user's own edits are the point of this one: a re-run must fill gaps
  // only, never restate what somebody chose.
  it("NEVER overwrites a row that already carries tags", () => {
    const { writes, skipped } = planTagWrites([row("o1", "Inception", F, ["heist"])], F);
    expect(writes).toEqual([]);
    expect(skipped).toEqual(["Inception"]);
  });

  it("treats an EMPTY array as untagged, not as a value", () => {
    const { writes } = planTagWrites([row("o1", "Dune", F, [])], F);
    expect(writes).toHaveLength(1);
  });

  // A renamed row must surface rather than disappear — silence here would read
  // as "everything was tagged".
  it("REPORTS a label it has no authored tags for", () => {
    const { writes, unmatched } = planTagWrites([row("o1", "Some Film Nobody Listed", F)], F);
    expect(writes).toEqual([]);
    expect(unmatched).toEqual(["Some Film Nobody Listed"]);
  });

  it("de-duplicates the unmatched report", () => {
    const { unmatched } = planTagWrites(
      [row("o1", "Unknown", F), row("o2", "Unknown", F)], F);
    expect(unmatched).toEqual(["Unknown"]);
  });

  // The same title exists on two boards (Library AND Readings) as separate
  // occurrences; both should be tagged.
  it("tags every occurrence sharing a title", () => {
    const { writes } = planTagWrites(
      [row("o1", "Meditations", F), row("o2", "Meditations", F)], F);
    expect(writes.map((w) => w.id)).toEqual(["o1", "o2"]);
  });
});
