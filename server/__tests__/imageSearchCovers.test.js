// Guards 0259. This is the one cover source that matches on NOTHING, so the
// tests pin the things that keep it from doing damage: it never overwrites, it
// never searches a blank label, and a throttled proxy cannot read as "no result".
import { describe, it, expect } from "vitest";
import { buildQuery, pickImage, searchImages, KIND_QUERY } from "../migrations/0259-image-search-covers.mjs";

describe("0259 — image-search covers", () => {
  it("puts the KIND in the query, because a bare title is ambiguous", () => {
    expect(buildQuery("Styx", "artist")).toBe("Styx band musician");
    expect(buildQuery("Humbug", "album", "Arctic Monkeys")).toBe("Humbug Arctic Monkeys album cover");
    expect(buildQuery("The Way of Zen", "book")).toBe("The Way of Zen book cover");
  });

  it("prefers the CDN thumbnail over the original host", () => {
    expect(pickImage([{ image: "https://host/orig.jpg", thumbnail: "https://tse.bing/t.jpg" }])).toBe("https://tse.bing/t.jpg");
    expect(pickImage([{ image: "https://host/orig.jpg" }])).toBe("https://host/orig.jpg");
  });

  it("skips non-https and empty results rather than storing junk", () => {
    expect(pickImage([{ thumbnail: "http://insecure/t.jpg" }, { thumbnail: "https://ok/t.jpg" }])).toBe("https://ok/t.jpg");
    expect(pickImage([])).toBeNull();
    expect(pickImage(null)).toBeNull();
  });

  it("THROWS on a refused request — a throttled proxy is not 'no result'", async () => {
    await expect(searchImages("q", "http://b", async () => ({ ok: false, status: 429 }))).rejects.toThrow(/429/);
  });

  it("returns null — not a throw — when the search genuinely finds nothing", async () => {
    expect(await searchImages("q", "http://b", async () => ({ ok: true, json: async () => ({ results: [] }) }))).toBeNull();
  });

  it("covers every kind it claims to, and never songs", () => {
    expect(Object.keys(KIND_QUERY).sort()).toEqual(["album", "artist", "book", "comic", "game", "movie", "series"]);
    expect(KIND_QUERY.song).toBeUndefined();     // songs inherit from their album
  });
});
