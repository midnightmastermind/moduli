// The Spotify export reader. Every case here is a shape the REAL file contains
// — the counts in the comments were measured on `My Spotify Library.csv`
// (4443 rows) before any of this was written.
import { describe, it, expect } from "vitest";
import { splitCsvLine, parseCsv, normName, readSpotifyLibrary, linkSongs, allArtists, allAlbums, derivedKey } from "../utils/spotifyLibrary.js";

const HEAD = "Track name,Artist name,Album,Playlist name,Type,ISRC,Spotify - id";
const row = (t, a, al, ty, id, isrc = "") =>
  `"${t}","${a}","${al}","Favorite Songs","${ty}","${isrc}","${id}"`;

describe("the CSV itself", () => {
  it("keeps a comma that lives INSIDE a quoted field", () => {
    // Real titles carry them: "Everybody's Home, Nobody's Happy".
    expect(splitCsvLine('"Goin To Hell","Sawyer Hill","Everybody\'s Home, Nobody\'s Happy"'))
      .toEqual(["Goin To Hell", "Sawyer Hill", "Everybody's Home, Nobody's Happy"]);
  });

  it("unescapes a doubled quote", () => {
    expect(splitCsvLine('"He said ""hi""","x"')).toEqual(['He said "hi"', "x"]);
  });

  it("keeps EMPTY trailing cells — the artist rows depend on it", () => {
    // An artist row is `name,,,playlist,Artist,,id`. A splitter that dropped
    // empty cells would shift every column right and make the Type unreadable.
    expect(splitCsvLine('"Gonzo","","","Favorite Artists","Artist","","abc"'))
      .toEqual(["Gonzo", "", "", "Favorite Artists", "Artist", "", "abc"]);
  });

  it("strips the BOM, which otherwise renames the FIRST column", () => {
    // Spotify's export is BOM-prefixed. Left in, the key becomes "﻿Track
    // name" and every song loses its title while every other column reads fine
    // — the failure looks like a title problem, not an encoding one.
    const rows = parseCsv("﻿" + HEAD + "\n" + row("T", "A", "Al", "Favorite", "id1"));
    expect(Object.keys(rows[0])[0]).toBe("Track name");
    expect(rows[0]["Track name"]).toBe("T");
  });
});

describe("the three things the file holds", () => {
  const text = [HEAD,
    row("Goin To Hell", "Sawyer Hill", "Everybody's Home", "Favorite", "s1", "QM1"),
    row("Parallel Universe (Deluxe Edition)", "Plain White T's", "Parallel Universe (Deluxe Edition)", "Album", "b1"),
    row("Gonzo", "", "", "Artist", "a1"),
  ].join("\n");

  it("reads the ARTIST's name out of the Track column", () => {
    // THE defect this file exists to prevent: an artist row has NO `Artist
    // name`. Reading that column yields nothing for all 163 favourites.
    const { artists } = readSpotifyLibrary(text);
    expect(artists).toEqual([{ name: "Gonzo", key: "gonzo", spotifyId: "a1" }]);
  });

  it("separates a song from an album that shares its title", () => {
    // "Parallel Universe" is a Red Hot Chili Peppers SONG and a Plain White
    // T's ALBUM in this very file. Only `Type` tells them apart.
    const { songs, albums } = readSpotifyLibrary(text);
    expect(songs.map((s) => s.title)).toEqual(["Goin To Hell"]);
    expect(albums.map((a) => a.title)).toEqual(["Parallel Universe (Deluxe Edition)"]);
  });

  it("reports an unknown Type rather than silently dropping the row", () => {
    const { skipped, songs } = readSpotifyLibrary(HEAD + "\n" + row("X", "Y", "Z", "Podcast", "p1"));
    expect(songs).toEqual([]);
    expect(skipped[0].why).toMatch(/unknown Type "Podcast"/);
  });

  it("drops a row with no name at all, and SAYS SO", () => {
    const { artists, skipped } = readSpotifyLibrary(HEAD + "\n" + row("", "", "", "Artist", "a9"));
    expect(artists).toEqual([]);
    expect(skipped[0].why).toMatch(/artist row with no name/);
  });
});

describe("de-duplication", () => {
  it("collapses ONE album released under two Spotify ids", () => {
    // Measured: 202 album rows, 199 distinct — `GIVE UP`, `There I Go` and
    // `Man On The Moon III` each appear twice with different ids (re-releases).
    // Two rows would be two board entries for one album the user starred once.
    const text = [HEAD,
      row("GIVE UP", "Nahko And Medicine For The People", "GIVE UP", "Album", "59elz"),
      row("GIVE UP", "Nahko And Medicine For The People", "GIVE UP", "Album", "1ukYK"),
    ].join("\n");
    expect(readSpotifyLibrary(text).albums).toHaveLength(1);
  });

  it("keeps two DIFFERENT artists' albums of the same name", () => {
    // The discriminator: dedupe is on artist AND title, so it cannot merge
    // two different records that happen to share a name.
    const text = [HEAD,
      row("Greatest Hits", "Artist One", "Greatest Hits", "Album", "x1"),
      row("Greatest Hits", "Artist Two", "Greatest Hits", "Album", "x2"),
    ].join("\n");
    expect(readSpotifyLibrary(text).albums).toHaveLength(2);
  });

  it("keeps two songs that share a title, because the ID is the identity", () => {
    const text = [HEAD,
      row("Parallel Universe", "Red Hot Chili Peppers", "Californication", "Favorite", "s1"),
      row("Parallel Universe", "Plain White T's", "Parallel Universe", "Favorite", "s2"),
    ].join("\n");
    expect(readSpotifyLibrary(text).songs).toHaveLength(2);
  });
});

describe("linking a song to the favourites that exist", () => {
  const songs = [
    { title: "A", artistKey: "eminem", albumKey: "eminem the eminem show" },
    { title: "B", artistKey: "nobody", albumKey: "nobody some record" },
  ];

  it("links only what the user actually favourited", () => {
    const { songs: out, linkedArtist, linkedAlbum } =
      linkSongs(songs, ["eminem"], ["eminem the eminem show"]);
    expect(out[0].artistKey).toBe("eminem");
    expect(out[0].albumKey).toBe("eminem the eminem show");
    expect(linkedArtist).toBe(1);
    expect(linkedAlbum).toBe(1);
  });

  it("INVENTS NOTHING for a song whose artist is not a favourite", () => {
    // The user chose "favourites, linked". Most songs legitimately carry no
    // link — measured, 30% reach a favourite artist and 21% an album — so a
    // null here is the correct answer, not a shortfall to paper over.
    const { songs: out } = linkSongs(songs, ["eminem"], ["eminem the eminem show"]);
    expect(out[1].artistKey).toBeNull();
    expect(out[1].albumKey).toBeNull();
  });

  it("matches on normalised names — case and spacing only", () => {
    const { songs: out } = linkSongs(
      [{ artistKey: normName("  Kid   CUDI "), albumKey: "x" }], ["kid cudi"], []);
    expect(out[0].artistKey).toBe("kid cudi");
  });

  it("an artist link does not imply an album link", () => {
    // 1264 songs reach a favourite artist but only 871 an album; the two are
    // resolved independently and a shared code path would hide that.
    const { songs: out } = linkSongs(songs, ["eminem"], []);
    expect(out[0].artistKey).toBe("eminem");
    expect(out[0].albumKey).toBeNull();
  });
});

describe("the FULL cast — every artist and album a song mentions", () => {
  // User revised the scope: *"put the artists and albums in that i dont have.
  // like if i have a song make sure the artist is in the artist board."*
  const lib = {
    artists: [{ name: "Eminem", key: "eminem", spotifyId: "a1" }],
    albums:  [{ title: "The Eminem Show", artist: "Eminem", key: "eminem the eminem show", artistKey: "eminem", spotifyId: "b1" }],
    songs: [
      { title: "Sing", artist: "Eminem", album: "The Eminem Show", artistKey: "eminem", albumKey: "eminem the eminem show" },
      { title: "Nikes", artist: "Frank Ocean", album: "Blonde", artistKey: "frank ocean", albumKey: "frank ocean blonde" },
    ],
  };

  it("adds an artist that only appears in song credits", () => {
    const out = allArtists(lib);
    expect(out.map((a) => a.key).sort()).toEqual(["eminem", "frank ocean"]);
  });

  it("does NOT duplicate an artist who is both starred and credited", () => {
    // The merge is keyed on the normalised name; a concatenation would give
    // Eminem two rows — one with an id and one without.
    expect(allArtists(lib).filter((a) => a.key === "eminem")).toHaveLength(1);
  });

  it("the FAVOURITE wins the merge, keeping its Spotify id and its flag", () => {
    const em = allArtists(lib).find((a) => a.key === "eminem");
    expect(em.favorite).toBe(true);
    expect(em.spotifyId).toBe("a1");       // a credited-only row has none
    const fo = allArtists(lib).find((a) => a.key === "frank ocean");
    expect(fo.favorite).toBe(false);
    expect(fo.spotifyId).toBe("");
  });

  it("does the same for albums, keeping the artist a credited album appeared under", () => {
    const out = allAlbums(lib);
    expect(out.map((a) => a.key).sort()).toEqual(["eminem the eminem show", "frank ocean blonde"]);
    expect(out.find((a) => a.key === "frank ocean blonde").artistKey).toBe("frank ocean");
  });

  it("skips a song with NO album rather than minting a blank album row", () => {
    const out = allAlbums({ albums: [], songs: [{ title: "x", artist: "A", album: "", artistKey: "a", albumKey: "a " }] });
    expect(out).toEqual([]);
  });

  it("gives a credited row a DETERMINISTIC id, so a re-run recognises it", () => {
    // A derived row has no Spotify id — the id on a song row belongs to the
    // SONG. Without a stable key of its own it would be re-minted every pass.
    expect(derivedKey("artist", "frank ocean")).toBe("artist:frank ocean");
    expect(derivedKey("artist", "frank ocean")).toBe(derivedKey("artist", "frank ocean"));
  });

  it("EVERY song reaches both an artist and an album row — the whole ask", () => {
    const A = new Set(allArtists(lib).map((a) => a.key));
    const B = new Set(allAlbums(lib).map((a) => a.key));
    for (const s of lib.songs) {
      expect(A.has(s.artistKey), `${s.title} has no artist row`).toBe(true);
      expect(B.has(s.albumKey), `${s.title} has no album row`).toBe(true);
    }
  });
});
