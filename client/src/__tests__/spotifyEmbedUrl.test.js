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
    s1: { id: "s1", moduleId: "S", label: "Stan", fields: {} },
    s2: { id: "s2", moduleId: "S", label: "Bad Guy", fields: {} },
    s3: { id: "s3", moduleId: "S", label: "Bonus", fields: { album: { value: "al" } } },
    ar: { id: "ar", moduleId: "P", label: "Eminem", fields: {} },
  };
  it("lists its songs in its own order, then songs that name it — not the artist (control)", () => {
    expect(albumSongIds("al", { occurrencesById, modulesById })).toEqual(["s1", "s2", "s3"]);
  });
  it("each song is a mini record that plays the album through Spotify when it has no audio of its own", () => {
    const items = albumShelfItems("al", { occurrencesById, modulesById });
    expect(items.map((i) => [i.title, i.mini, i.src, i.spotify])).toEqual([
      ["Stan", true, null, "https://open.spotify.com/embed/album/X1"],
      ["Bad Guy", true, null, "https://open.spotify.com/embed/album/X1"],
      ["Bonus", true, null, "https://open.spotify.com/embed/album/X1"],
    ]);
  });
});
