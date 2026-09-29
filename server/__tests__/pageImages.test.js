// server/__tests__/pageImages.test.js
//
// `imagesFromHtml` — the pictures the placement window offers for a clip.
//
// The refusals matter more than the matches: a tracking pixel or a favicon
// stretched into a poster slot is worse than the title text it replaces.
import { describe, it, expect } from "vitest";
import { imagesFromHtml, PAGE_IMAGE_CAP } from "../utils/pageImages.js";
import { coverFromHtml } from "../utils/pageCover.js";

const PAGE = "https://example.com/films/saints";

describe("imagesFromHtml", () => {
  it("puts the page's DECLARED picture first, then its <img> in order", () => {
    const out = imagesFromHtml(`
      <meta property="og:image" content="https://cdn.example.com/og.jpg">
      <img src="https://cdn.example.com/a.jpg" alt="one">
      <img src="https://cdn.example.com/b.jpg">
    `, PAGE);
    expect(out.map((c) => c.url)).toEqual([
      "https://cdn.example.com/og.jpg",
      "https://cdn.example.com/a.jpg",
      "https://cdn.example.com/b.jpg",
    ]);
    expect(out[0].via).toBe("declared");
    expect(out[1]).toMatchObject({ via: "img", alt: "one" });
  });

  // The two files answer different questions and must not disagree about
  // which picture the page CLAIMS is its own — the window shows `cover` as the
  // suggestion and these as the alternatives.
  it("agrees with pageCover about which one is the og:image", () => {
    const html = `
      <link rel="apple-touch-icon" href="/touch.png">
      <meta property="og:image" content="https://cdn.example.com/og.jpg">
      <img src="https://cdn.example.com/body.jpg">
    `;
    expect(coverFromHtml(html, PAGE)).toMatchObject({ url: "https://cdn.example.com/og.jpg", via: "og" });
    expect(imagesFromHtml(html, PAGE)[0].url).toBe("https://cdn.example.com/og.jpg");
  });

  it("resolves relative sources against the page", () => {
    const out = imagesFromHtml(`<img src="/img/poster.jpg"><img src="../up.png">`, PAGE);
    expect(out.map((c) => c.url)).toEqual([
      "https://example.com/img/poster.jpg",
      "https://example.com/up.png",
    ]);
  });

  it("reads a srcset, not the src — a lazy page's src is a placeholder", () => {
    // 2026-09-15: badgerherald.com's `src` is an alias that 404s while the
    // srcset holds the real uploads. One definition of "which URL does this
    // <img> mean", shared with the importers.
    const out = imagesFromHtml(
      `<img src="https://cdn.example.com/tiny.gif" srcset="https://cdn.example.com/w800.jpg 800w, https://cdn.example.com/w1600.jpg 1600w">`,
      PAGE,
    );
    expect(out[0].url).toBe("https://cdn.example.com/w1600.jpg");
  });

  it("refuses a data: URI — those are tracking pixels and inline spinners", () => {
    const out = imagesFromHtml(
      `<img src="data:image/gif;base64,R0lGOD"><img src="https://cdn.example.com/real.jpg">`,
      PAGE,
    );
    expect(out.map((c) => c.url)).toEqual(["https://cdn.example.com/real.jpg"]);
  });

  it("refuses an image the page DECLARES is tiny", () => {
    const out = imagesFromHtml(`
      <img src="https://cdn.example.com/pixel.gif" width="1" height="1">
      <img src="https://cdn.example.com/icon.png" width="32">
      <img src="https://cdn.example.com/poster.jpg" width="600" height="900">
    `, PAGE);
    expect(out.map((c) => c.url)).toEqual(["https://cdn.example.com/poster.jpg"]);
  });

  // The CONTROL for the rule above: most real images declare no size at all,
  // and refusing those would leave nearly every page with nothing to offer.
  it("keeps an image that declares no size", () => {
    const out = imagesFromHtml(`<img src="https://cdn.example.com/poster.jpg">`, PAGE);
    expect(out).toHaveLength(1);
  });

  it("never offers a favicon — a page's icon is not its poster", () => {
    const out = imagesFromHtml(`
      <link rel="icon" href="/favicon.ico">
      <link rel="apple-touch-icon" href="/touch.png">
    `, PAGE);
    expect(out).toEqual([]);
  });

  it("dedupes by resolved URL, so og:image is not offered twice", () => {
    const out = imagesFromHtml(`
      <meta property="og:image" content="https://example.com/p.jpg">
      <img src="/p.jpg">
    `, PAGE);
    expect(out).toHaveLength(1);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 60 }, (_, i) => `<img src="https://cdn.example.com/${i}.jpg">`).join("");
    expect(imagesFromHtml(many, PAGE)).toHaveLength(PAGE_IMAGE_CAP);
    expect(imagesFromHtml(many, PAGE, { max: 3 })).toHaveLength(3);
  });

  it("answers empty for junk rather than throwing", () => {
    expect(imagesFromHtml("", PAGE)).toEqual([]);
    expect(imagesFromHtml(null, PAGE)).toEqual([]);
    expect(imagesFromHtml("<img>", PAGE)).toEqual([]);
    expect(imagesFromHtml(`<img src="not a url">`, "also not a url")).toEqual([]);
  });
});
