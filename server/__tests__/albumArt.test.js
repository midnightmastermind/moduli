// Guards 0257. A SEARCH can return the wrong record, so the question each test
// answers is "could this put another band's sleeve on this album?"
import { describe, it, expect } from "vitest";
import { normName, nameMatches, upscale, pickAlbumResult, findAlbumArt } from "../migrations/0257-album-art-itunes.mjs";

const r = (collectionName, artistName, art = "https://is1.mzstatic.com/x/100x100bb.jpg") =>
  ({ collectionName, artistName, artworkUrl100: art });

describe("0257 — album art, gated on title AND artist", () => {
  it("accepts only when BOTH names match", () => {
    const hit = pickAlbumResult([r("Black Sunday", "Cypress Hill")], "Black Sunday", "Cypress Hill");
    expect(hit.url).toContain("600x600bb");
  });

  it("REFUSES a title match whose artist is someone else", () => {
    // The whole risk: "Black Sunday" is a common album title.
    expect(pickAlbumResult([r("Black Sunday", "Someone Else")], "Black Sunday", "Cypress Hill")).toBeNull();
  });

  it("REFUSES an artist match whose album is a different record", () => {
    expect(pickAlbumResult([r("Some Other Record", "Cypress Hill")], "Black Sunday", "Cypress Hill")).toBeNull();
  });

  it("scans past a wrong leading result to a correct later one", () => {
    const hit = pickAlbumResult([r("Black Sunday", "Nobody"), r("Black Sunday", "Cypress Hill")], "Black Sunday", "Cypress Hill");
    expect(hit.artistName).toBe("Cypress Hill");
  });

  it("tolerates deluxe/edition suffixes and punctuation, not different names", () => {
    expect(nameMatches("Humbug", "Humbug (Deluxe Edition)")).toBe(true);
    expect(nameMatches("Sgt. Pepper's", "Sgt Peppers")).toBe(true);
    expect(nameMatches("Café", "Cafe")).toBe(true);
    expect(nameMatches("Humbug", "Favourite Worst Nightmare")).toBe(false);
    expect(nameMatches("", "Anything")).toBe(false);
  });

  it("asks for a usable size instead of the 100px thumbnail", () => {
    expect(upscale("https://x/100x100bb.jpg")).toBe("https://x/600x600bb.jpg");
    expect(upscale(null)).toBeNull();
  });

  it("returns null rather than throwing when iTunes answers badly", async () => {
    expect(await findAlbumArt("a", "b", async () => ({ ok: false }))).toBeNull();
    expect(await findAlbumArt("a", "b", async () => ({ ok: true, json: async () => ({}) }))).toBeNull();
  });

  it("normalises articles so 'The Beatles' matches 'Beatles'", () => {
    expect(normName("The Beatles")).toBe("beatles");
  });
});
