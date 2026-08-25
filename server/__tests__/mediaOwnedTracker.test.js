// 0239 — the decisions in "put how much media i own of what under trackers".
import { describe, it, expect } from "vitest";
import { COUNTS, varFor } from "../migrations/0239-media-owned-tracker.mjs";

describe("COUNTS — what the tile reports, and what it deliberately does not", () => {
  it("counts the seven kinds that are FILES on a disk", () => {
    expect(COUNTS.map(([, tag]) => tag))
      .toEqual(["movie", "series", "documentary", "game", "comic", "book", "album"]);
  });

  it("does NOT count artists — a person is not a thing you own", () => {
    expect(COUNTS.map(([, t]) => t)).not.toContain("artist");
  });

  it("names every field 'Owned' so the tile cannot be read as a total", () => {
    // The Albums count is the 271 local rips, NOT the 2,757 Spotify rows: those
    // are a streaming library, not files. The label is what keeps that honest.
    for (const [name] of COUNTS) expect(name.endsWith("Owned")).toBe(true);
  });

  it("keeps every field name distinct — `[Field]` tokens resolve BY NAME", () => {
    const names = COUNTS.map(([n]) => n);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("varFor — a pipeline var name the executor can carry", () => {
  it("strips everything a $var cannot hold", () => {
    expect(varFor("TV Series Owned")).toBe("$tvseriesowned");
    expect(varFor("Movies Owned")).toBe("$moviesowned");
  });

  it("gives every count its OWN var — a collision would silently merge two counts", () => {
    const vars = COUNTS.map(([n]) => varFor(n));
    expect(new Set(vars).size).toBe(COUNTS.length);
  });
});
