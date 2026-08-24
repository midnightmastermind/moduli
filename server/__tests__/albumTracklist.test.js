// 0223 — the two decisions in "a liked album brings its whole tracklist",
// driven dry. Both are exported from what ships, so the test cannot drift.
import { describe, it, expect } from "vitest";
import { pickRelease } from "../utils/providers/musicbrainz.js";
import { missingTracks } from "../migrations/0223-liked-album-full-tracklist.mjs";

describe("pickRelease — WHICH pressing of an album to believe", () => {
  // Measured live: MusicBrainz answers "K.I.D.S." by Mac Miller with a
  // 17-track release AND an 18-track one. Something has to choose.
  const rs = [
    { id: "deluxe", "track-count": 25 },
    { id: "standard", "track-count": 17 },
    { id: "single", "track-count": 2 },
  ];

  it("prefers the pressing closest to the track count we already expect", () => {
    // The album already holds 17 liked songs -> the 17-track release is the one
    // the user is actually looking at.
    expect(pickRelease(rs, { trackHint: 17 }).id).toBe("standard");
    expect(pickRelease(rs, { trackHint: 24 }).id).toBe("deluxe");
  });

  it("with NO hint takes the smallest, not the biggest", () => {
    // A deluxe/anniversary edition pads a record with alternate takes, live
    // cuts and instrumentals. Importing those as if they were the album gives
    // the user 25 rows for a record they think of as 17.
    expect(pickRelease(rs).id).toBe("single");
  });

  it("ignores a release with NO tracks rather than picking it as smallest", () => {
    // A zero-track release is a stub entry in the catalogue. Without this it
    // would win every no-hint comparison and the album would import nothing
    // while reporting success.
    expect(pickRelease([{ id: "stub", "track-count": 0 }, { id: "real", "track-count": 12 }]).id).toBe("real");
  });

  it("returns null rather than guessing when there is nothing usable", () => {
    expect(pickRelease([])).toBeNull();
    expect(pickRelease(null)).toBeNull();
    expect(pickRelease([{ id: "stub", "track-count": 0 }])).toBeNull();
  });
});

describe("missingTracks — what the album does not already have", () => {
  const catalog = [
    { position: 1, title: "Nikes On My Feet" },
    { position: 2, title: "The Spins" },
    { position: 3, title: "Kool Aid & Frozen Pizza" },
  ];

  it("matches on the NORMALISED title, so one track is not imported twice", () => {
    // The liked-song row and the catalogue row are the same track under two
    // spellings — Spotify says "Nikes on My Feet", MusicBrainz "Nikes On My
    // Feet". A case-sensitive compare imports a duplicate of every track.
    const out = missingTracks(catalog, ["Nikes on My Feet", "the spins"]);
    expect(out.map((t) => t.title)).toEqual(["Kool Aid & Frozen Pizza"]);
  });

  it("de-dupes WITHIN the catalogue too", () => {
    // A release legitimately lists a track twice (a reprise, or the same
    // recording on two discs of one release).
    const dup = [{ title: "Intro" }, { title: "intro" }, { title: "Outro" }];
    expect(missingTracks(dup, []).map((t) => t.title)).toEqual(["Intro", "Outro"]);
  });

  it("returns EVERYTHING for an album that has no songs yet", () => {
    // The 81 starred albums this migration exists for: saved as albums, with
    // no individual track ever liked.
    expect(missingTracks(catalog, [])).toHaveLength(3);
  });

  it("returns NOTHING when the album is already complete — so a re-run adds none", () => {
    expect(missingTracks(catalog, catalog.map((t) => t.title))).toEqual([]);
  });

  it("skips a track with no title rather than minting a blank row", () => {
    expect(missingTracks([{ title: "" }, { title: null }, { title: "Real" }], []))
      .toEqual([{ title: "Real" }]);
  });

  it("survives an empty or absent catalogue", () => {
    // An album MusicBrainz does not carry. It must add nothing and not throw —
    // the migration still stamps it so it is never looked up again.
    expect(missingTracks([], ["A"])).toEqual([]);
    expect(missingTracks(null, ["A"])).toEqual([]);
  });
});
