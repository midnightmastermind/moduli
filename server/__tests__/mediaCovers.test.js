// Guards 0254. It writes cover art onto ~700 live rows from third-party APIs, so
// each test answers "could this attach a picture that belongs to something else?"
import { describe, it, expect } from "vitest";
import { spotifyThumb, normTitle, titleMatches, spotifyKind, fetchOpenLibrary, fetchSpotifyCover } from "../migrations/0254-media-covers.mjs";

describe("0254 — cover sources", () => {
  it("takes an https thumbnail from oEmbed and nothing else", () => {
    expect(spotifyThumb({ thumbnail_url: "https://i.scdn.co/x.jpg" })).toBe("https://i.scdn.co/x.jpg");
    expect(spotifyThumb({ thumbnail_url: "http://insecure/x.jpg" })).toBeNull();
    expect(spotifyThumb({})).toBeNull();
    expect(spotifyThumb(null)).toBeNull();
  });

  it("reads the Spotify id kind, so an album URL is never asked of another endpoint", () => {
    expect(spotifyKind("https://open.spotify.com/album/7nK5")).toBe("album");
    expect(spotifyKind("https://open.spotify.com/artist/3NqV")).toBe("artist");
    expect(spotifyKind("https://example.com/album/1")).toBeNull();
    expect(spotifyKind(null)).toBeNull();
  });

  it("normalises titles past case, accents, punctuation and articles", () => {
    expect(normTitle("The Way of Zen")).toBe("way of zen");
    expect(normTitle("Sgt. Pepper's  Lonely-Hearts")).toBe("sgt peppers lonely hearts");
    expect(normTitle("Café & Bar")).toBe("cafe and bar");
  });

  it("ACCEPTS a subtitle or edition suffix but REFUSES a different book", () => {
    expect(titleMatches("The Way of Zen", "The Way of Zen")).toBe(true);
    expect(titleMatches("The Way of Zen", "Way of Zen: 50th Anniversary Edition")).toBe(true);
    expect(titleMatches("The Way of Zen", "The Art of War")).toBe(false);
    expect(titleMatches("", "Anything")).toBe(false);          // an empty label matches nothing
    expect(titleMatches("Anything", "")).toBe(false);
  });

  it("REFUSES the wrong book even when Open Library returns a real cover — the bogus-ISBN case", async () => {
    // Probed live: ISBN 0000000000000 returns a REAL cover and a REAL record.
    // The title gate is the only thing standing between that and a stranger's
    // cover on the user's shelf.
    const fake = async () => ({ ok: true, json: async () => ({
      "ISBN:0000000000000": { title: "Some Other Book", cover: { large: "https://covers/x.jpg" } },
    }) });
    const got = await fetchOpenLibrary("0000000000000", fake);
    expect(got.url).toBe("https://covers/x.jpg");               // the API DID answer
    expect(titleMatches("The Way of Zen", got.title)).toBe(false); // …and we refuse it
  });

  it("returns null rather than throwing when a service answers badly", async () => {
    expect(await fetchSpotifyCover("https://open.spotify.com/album/x", async () => ({ ok: false }))).toBeNull();
    expect(await fetchOpenLibrary("123", async () => ({ ok: false }))).toBeNull();
    expect(await fetchOpenLibrary("123", async () => ({ ok: true, json: async () => ({}) }))).toBeNull();
  });
});
