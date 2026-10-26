import { describe, it, expect } from "vitest";
import { spotifyEmbedUrl } from "../vr/shelfItems.js";

describe("spotifyEmbedUrl", () => {
  it("turns an album's Spotify URL field into Spotify's embedded player", () => {
    const occ = { fields: { a: { value: ["album"] }, u: { value: "https://open.spotify.com/album/5DV2liMHX5AqtiLqy3Qu1b" } } };
    expect(spotifyEmbedUrl(occ)).toBe("https://open.spotify.com/embed/album/5DV2liMHX5AqtiLqy3Qu1b");
  });
  it("reads tracks, playlists and localized links", () => {
    expect(spotifyEmbedUrl({ fields: { u: { value: "https://open.spotify.com/intl-de/track/abc123?si=x" } } })).toBe("https://open.spotify.com/embed/track/abc123");
    expect(spotifyEmbedUrl({ fields: { u: "https://open.spotify.com/playlist/P1" } })).toBe("https://open.spotify.com/embed/playlist/P1");
  });
  it("is null when nothing links to Spotify (control)", () => {
    expect(spotifyEmbedUrl({ fields: { u: { value: "https://example.com/album/1" } } })).toBeNull();
    expect(spotifyEmbedUrl({})).toBeNull();
  });
});

import { albumShelfItems, albumSongIds } from "../vr/shelfItems.js";
describe("an album opened on a record shelf", () => {
  const modulesById = { A: { id: "A", kind: "album", role: "artifact" }, S: { id: "S", kind: "song", role: "artifact" }, P: { id: "P", kind: "artist", role: "artifact" } };
  const occurrencesById = {
    al: { id: "al", moduleId: "A", label: "STANS", fields: { songs: { value: ["s1", "s2"] }, artist: { value: "ar" }, url: { value: "https://open.spotify.com/album/X1" } } },
    s1: { id: "s1", moduleId: "S", label: "Stan", fields: {}, meta: { searchProvider: "spotify", searchExternalId: "STAN123456" } },
    s2: { id: "s2", moduleId: "S", label: "Bad Guy", fields: {} },
    s3: { id: "s3", moduleId: "S", label: "Bonus", fields: { album: { value: "al" } } },
    ar: { id: "ar", moduleId: "P", label: "Eminem", fields: {} },
  };
  it("lists its songs in its own order, then songs that name it — not the artist (control)", () => {
    expect(albumSongIds("al", { occurrencesById, modulesById })).toEqual(["s1", "s2", "s3"]);
  });
  it("each song is a mini record that plays only its own track — never the album's (which starts at track 1)", () => {
    const items = albumShelfItems("al", { occurrencesById, modulesById });
    expect(items.map((i) => [i.title, i.mini, i.src, i.spotify])).toEqual([
      ["Stan", true, null, "https://open.spotify.com/embed/track/STAN123456"],
      ["Bad Guy", true, null, null],
      ["Bonus", true, null, null],
    ]);
  });
});

import { spotifySearchUrl, albumShelfItems as albumItems2 } from "../vr/shelfItems.js";
describe("a song with no Spotify link", () => {
  it("has nothing to play on Spotify (not a search, not its album)", () => {
    const modulesById = { A: { id: "A", kind: "album", label: "Album" }, S: { id: "S", kind: "song", label: "Song" } };
    const occurrencesById = {
      al: { id: "al", moduleId: "A", label: "Just Push Play", meta: { mediaArtist: "Aerosmith" }, fields: { songs: { value: ["s1"] }, u: { value: "https://open.spotify.com/album/AL1" } } },
      s1: { id: "s1", moduleId: "S", label: "Jaded", fields: {} },
    };
    expect(albumItems2("al", { occurrencesById, modulesById })[0].spotify).toBeNull();
  });
});

import { albumSongIds as songIds3 } from "../vr/shelfItems.js";
describe("an album's songs", () => {
  it("are in track order when the songs carry one", () => {
    const modulesById = { A: { id: "A", kind: "album" }, S: { id: "S", kind: "song" } };
    const occurrencesById = {
      al: { id: "al", moduleId: "A", fields: {} },
      t3: { id: "t3", moduleId: "S", meta: { trackNumber: 3 }, fields: { a: { value: "al" } } },
      t1: { id: "t1", moduleId: "S", meta: { trackNumber: 1 }, fields: { a: { value: "al" } } },
      t2: { id: "t2", moduleId: "S", meta: { trackNumber: 2 }, fields: { a: { value: "al" } } },
    };
    expect(songIds3("al", { occurrencesById, modulesById })).toEqual(["t1", "t2", "t3"]);
  });
});

import { albumQueue, shelfItems as shelfItems4 } from "../vr/shelfItems.js";
describe("an album with no Spotify link", () => {
  const modulesById = { A: { id: "A", kind: "album", role: "artifact" }, S: { id: "S", kind: "song", role: "artifact" } };
  const occurrencesById = {
    al: { id: "al", moduleId: "A", label: "Just Push Play", meta: { mediaArtist: "Aerosmith" }, fields: {} },
    t2: { id: "t2", moduleId: "S", label: "Jaded", meta: { trackNumber: 2, searchProvider: "spotify", searchExternalId: "JADED12345" }, fields: { a: { value: "al" } } },
    t1: { id: "t1", moduleId: "S", label: "Beyond Beautiful", meta: { trackNumber: 1 }, fields: { a: { value: "al" }, u: { value: "https://open.spotify.com/track/BEYOND1234" } } },
    t3: { id: "t3", moduleId: "S", label: "No Track", meta: { trackNumber: 3 }, fields: { a: { value: "al" } } },
  };
  it("plays as a queue of its songs' own tracks, in order (a song with no track is left out)", () => {
    expect(albumQueue("al", { occurrencesById, modulesById })).toEqual([
      { title: "Beyond Beautiful", url: "https://open.spotify.com/embed/track/BEYOND1234" },
      { title: "Jaded", url: "https://open.spotify.com/embed/track/JADED12345" },
    ]);
  });
});
