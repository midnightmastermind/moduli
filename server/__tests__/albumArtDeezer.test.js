// Guards 0258. Its whole reason to exist is that a THROTTLED request must not
// look like "no such album" — 0257 wrote 37 of 2,707 because it did.
import { describe, it, expect } from "vitest";
import { pickDeezerAlbum, findAlbumArt } from "../migrations/0258-album-art-deezer.mjs";

const r = (title, artist, cover = "https://cdn/xl.jpg") => ({ title, artist: { name: artist }, cover_xl: cover });

describe("0258 — Deezer album art", () => {
  it("accepts only when the title AND artist match", () => {
    expect(pickDeezerAlbum([r("Black Sunday", "Cypress Hill")], "Black Sunday", "Cypress Hill").url).toBe("https://cdn/xl.jpg");
    expect(pickDeezerAlbum([r("Black Sunday", "Someone Else")], "Black Sunday", "Cypress Hill")).toBeNull();
    expect(pickDeezerAlbum([r("Other Record", "Cypress Hill")], "Black Sunday", "Cypress Hill")).toBeNull();
  });

  it("THROWS on a refused request — the bug 0257 shipped", async () => {
    // A 403 must NOT come back as null: null is what "nobody made that album"
    // returns, and conflating them made 0257's abort guard unfireable.
    await expect(findAlbumArt("a", "b", async () => ({ ok: false, status: 403 }))).rejects.toThrow(/403/);
  });

  it("THROWS on Deezer's error payload, which arrives with HTTP 200", async () => {
    await expect(findAlbumArt("a", "b", async () => ({ ok: true, json: async () => ({ error: { code: 4 } }) })))
      .rejects.toThrow(/error payload/);
  });

  it("returns null — not a throw — for a genuine no-match", async () => {
    expect(await findAlbumArt("a", "b", async () => ({ ok: true, json: async () => ({ data: [] }) }))).toBeNull();
  });

  it("falls back through the cover sizes and refuses a non-http one", () => {
    expect(pickDeezerAlbum([{ title: "X", artist: { name: "Y" }, cover_big: "https://cdn/big.jpg" }], "X", "Y").url).toBe("https://cdn/big.jpg");
    expect(pickDeezerAlbum([{ title: "X", artist: { name: "Y" }, cover_xl: "/local.jpg" }], "X", "Y")).toBeNull();
  });
});
