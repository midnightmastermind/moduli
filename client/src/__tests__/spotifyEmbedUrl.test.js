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
