// 0223 — the two decisions in "a liked album brings its whole tracklist",
// driven dry. Both are exported from what ships, so the test cannot drift.
import { describe, it, expect } from "vitest";
import { pickRelease, baseTitle } from "../utils/providers/musicbrainz.js";
import { missingTracks } from "../migrations/0223-liked-album-full-tracklist.mjs";
import { sharedModuleQuery } from "../migrations/0222-import-spotify-library.mjs";

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

describe("sharedModuleQuery — the finder and the minter are one predicate", () => {
  // `0223` restated the lookup instead of importing it, and wrote `role:
  // "instance"` into its copy. The perf pass then made these modules
  // `artifact`, so the finder stopped matching what the minter makes — and the
  // symptom was `0223` reporting that `0222` had never run, on a grid carrying
  // all 8,428 of its rows. Both halves read correctly the whole time.
  it("matches a module shaped the way 0222 mints one, WHATEVER role it carries", () => {
    const q = sharedModuleQuery("g1", "Song");
    const minted = { gridId: "g1", label: "Song", role: "artifact", kind: "song", meta: { spotifyRow: true } };
    expect(matches(q, minted)).toBe(true);
    // The role this migration used to demand is the one thing that must NOT
    // decide the match, or the next role change silently breaks it again.
    expect(matches(q, { ...minted, role: "instance" })).toBe(true);
    expect(q.role).toBeUndefined();
  });

  it("still discriminates — a same-labelled module that is not a spotify row does not match", () => {
    const q = sharedModuleQuery("g1", "Song");
    expect(matches(q, { gridId: "g1", label: "Song", meta: {} })).toBe(false);
    expect(matches(q, { gridId: "g2", label: "Song", meta: { spotifyRow: true } })).toBe(false);
    expect(matches(q, { gridId: "g1", label: "Album", meta: { spotifyRow: true } })).toBe(false);
  });

  it("takes the gridId as a STRING, since that is what a Mongo match needs", () => {
    expect(sharedModuleQuery({ toString: () => "g1" }, "Song").gridId).toBe("g1");
  });
});

/** The subset of Mongo matching this predicate uses: equality, plus one
 *  dotted path. Enough to answer "would this query find that document". */
function matches(query, doc) {
  return Object.entries(query).every(([k, v]) =>
    k.split(".").reduce((o, part) => (o == null ? o : o[part]), doc) === v);
}

describe("baseTitle — the Spotify qualifier MusicBrainz does not carry", () => {
  // Measured against the live API on the starred albums that returned nothing:
  //   "Parallel Universe (Deluxe Edition)" 0 -> "Parallel Universe" 14 tracks
  //   "Love Is Like (Deluxe)"              0 -> "Love Is Like"      10
  //   "Baggage (feat. Ren)"                0 -> "Baggage"            1
  it("strips a trailing qualifier, whatever the qualifier says", () => {
    expect(baseTitle("Parallel Universe (Deluxe Edition)")).toBe("Parallel Universe");
    expect(baseTitle("Love Is Like (Deluxe)")).toBe("Love Is Like");
    expect(baseTitle("Baggage (feat. Ren)")).toBe("Baggage");
    expect(baseTitle("Kid A [Explicit]")).toBe("Kid A");
  });

  it("KEEPS a leading parenthetical — that one is part of the record's name", () => {
    // "(What's the Story) Morning Glory?" is the album's actual title. Stripping
    // it would search for a record that does not exist and lose one that does.
    expect(baseTitle("(What's the Story) Morning Glory?")).toBeNull();
  });

  it("returns null when there is nothing to strip, so the caller can tell", () => {
    // null is the "no fallback available" signal: `albumTracks` must not spend
    // a second request re-asking the identical question.
    expect(baseTitle("Blonde")).toBeNull();
    expect(baseTitle("K.I.D.S.")).toBeNull();
    expect(baseTitle("")).toBeNull();
    expect(baseTitle(null)).toBeNull();
  });

  it("never strips a title down to nothing", () => {
    // A title that is ONLY a parenthetical has no base to fall back to; the
    // regex requires a non-space character before the bracket.
    expect(baseTitle("(Deluxe)")).toBeNull();
    expect(baseTitle("[]")).toBeNull();
  });
});

describe("the empty-result retry — which rows are worth asking twice", () => {
  // `0223` stamps a row even when the lookup found nothing, so unknown records
  // are not re-fetched on every future run. That is right, and it also froze
  // the rows that failed only because of a qualifier. This is the exemption.
  const retryable = (a) =>
    a.meta?.tracklistCount === 0 && !a.meta?.tracklistBaseFallback && !!baseTitle(a.label);

  it("re-asks an empty result whose title has a strippable qualifier", () => {
    expect(retryable({ label: "Love Is Like (Deluxe)", meta: { tracklistCount: 0 } })).toBe(true);
  });

  it("leaves an empty result alone when stripping cannot help", () => {
    // "Father Mountain" carries no qualifier and returned nothing: it is simply
    // not in the catalogue, and asking again every run costs a request forever.
    expect(retryable({ label: "Father Mountain", meta: { tracklistCount: 0 } })).toBe(false);
  });

  it("retries at MOST once — the fallback stamp closes it", () => {
    // "FUNCTIONAL (Sugarshack Sessions)" returns nothing under either spelling.
    // Without this it would be re-asked on every single run, forever.
    expect(retryable({ label: "FUNCTIONAL (Sugarshack Sessions)",
                       meta: { tracklistCount: 0, tracklistBaseFallback: true } })).toBe(false);
  });

  it("never re-asks a row that FOUND something", () => {
    expect(retryable({ label: "Parallel Universe (Deluxe Edition)", meta: { tracklistCount: 14 } })).toBe(false);
  });
});
