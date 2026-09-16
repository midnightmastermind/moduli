import { describe, it, expect } from "vitest";
import { bestImageSrc, wikiHtmlToMarkdown, htmlToMarkdown, IMAGE_MAX_W } from "../services/wikipediaTools.js";

// Reader and Magic mode showed broken images on badgerherald.com: WordPress
// put a 404 alias in `src` and the working uploads in `srcset`. The markup below
// is that article's shape, trimmed.
const WP_IMG = `<img decoding="async" src="https://badgerherald.com/media/2015/04/tunnel-336x448.jpg" alt="Tunnel" srcset="https://badgerherald.com/wp-content/uploads/2015/04/tunnel-336x448.jpg 336w, https://badgerherald.com/wp-content/uploads/2015/04/tunnel-648x864.jpg 648w, https://badgerherald.com/wp-content/uploads/2015/04/tunnel-1200x1600.jpg 1200w, https://badgerherald.com/wp-content/uploads/2015/04/tunnel-3000x4000.jpg 3000w" sizes="(max-width: 336px) 100vw, 336px">`;
const attrs = (o) => (n) => (n in o ? o[n] : null);

// bbc.com wraps an article photo in a <figure> holding TWO <img> elements: a
// grey "image unavailable" placeholder FIRST (it carries only `src`), then the
// real photo, which carries only `srcset`. The figure rule took
// querySelector("img") — the first — so the reader showed the placeholder and
// dropped the photo. Measured: 1 image in the reader markdown, and it was the
// placeholder.
const BBC_FIGURE = `<figure>
  <img src="https://static.files.bbci.co.uk/grey-placeholder.png" class="hide-when-no-script" aria-label="image unavailable">
  <img sizes="96vw" srcset="https://ichef.bbci.co.uk/news/240/a.jpg.webp 240w,https://ichef.bbci.co.uk/news/1536/a.jpg.webp 1536w">
  <figcaption>A caption</figcaption>
</figure>`;

describe("figure with a placeholder beside the real image", () => {
  it("takes the image that OFFERS candidates, not the first one in the DOM", () => {
    const md = wikiHtmlToMarkdown(BBC_FIGURE, "bbc");
    expect(md).toContain("https://ichef.bbci.co.uk/news/1536/a.jpg.webp");
    expect(md).not.toContain("grey-placeholder");
  });

  // The SAME decision in the OTHER converter. htmlToMarkdown is the regex
  // converter the drag/paste-import path uses, and it read the first <img> of a
  // figure exactly as the turndown one did. Two converters implementing one
  // decision differently is how they drift.
  it("applies the same rule in the regex converter", () => {
    const md = htmlToMarkdown(BBC_FIGURE, "bbc", { keepFigures: true, keepImages: true });
    expect(md).toContain("https://ichef.bbci.co.uk/news/1536/a.jpg.webp");
    expect(md).not.toContain("grey-placeholder");
  });

  // The control: a figure with ONE image is unchanged, which is every figure on
  // Wikipedia and on the badgerherald article this work started from.
  it("leaves a single-image figure alone", () => {
    const md = wikiHtmlToMarkdown(
      `<figure><img src="https://x.com/only.jpg"><figcaption>Cap</figcaption></figure>`, "x");
    expect(md).toContain("![Cap](https://x.com/only.jpg)");
  });
});

// Measured on the same bbc.com article: SIX placeholder/photo pairs sit OUTSIDE
// any <figure>, as two <img> tags with ZERO characters between them — the
// placeholder first, carrying only `src`, then the photo carrying only `srcset`.
// Handling only figures left five grey boxes in a dragged import.
describe("a placeholder touching the real image", () => {
  const PAIR = `<p>Text</p><img src="https://static.bbci.co.uk/grey-placeholder.png" aria-label="image unavailable">`
    + `<img sizes="96vw" srcset="https://ichef.bbci.co.uk/news/1536/b.jpg.webp 1536w"><p>More</p>`;

  it("drops the one that offers nothing when they are adjacent", () => {
    const md = htmlToMarkdown(PAIR, "bbc", { keepImages: true });
    expect(md).toContain("https://ichef.bbci.co.uk/news/1536/b.jpg.webp");
    expect(md).not.toContain("grey-placeholder");
  });

  it("does the same in the turndown converter", () => {
    const md = wikiHtmlToMarkdown(PAIR, "bbc");
    expect(md).toContain("https://ichef.bbci.co.uk/news/1536/b.jpg.webp");
    expect(md).not.toContain("grey-placeholder");
  });

  // The control: two adjacent images that BOTH offer candidates are two real
  // pictures — a gallery — and neither may be dropped.
  it("keeps both when each offers candidates", () => {
    const two = `<img srcset="https://x.com/a.jpg 800w"><img srcset="https://x.com/b.jpg 800w">`;
    const md = htmlToMarkdown(two, "x", { keepImages: true });
    expect(md).toContain("https://x.com/a.jpg");
    expect(md).toContain("https://x.com/b.jpg");
  });

  // And two adjacent plain images are also both real (no srcset anywhere).
  it("keeps both when neither offers candidates", () => {
    const two = `<img src="https://x.com/a.jpg"><img src="https://x.com/b.jpg">`;
    const md = htmlToMarkdown(two, "x", { keepImages: true });
    expect(md).toContain("https://x.com/a.jpg");
    expect(md).toContain("https://x.com/b.jpg");
  });
});

describe("bestImageSrc", () => {
  it("takes srcset over a src that disagrees with it", () => {
    const src = bestImageSrc(attrs({
      src: "https://x.com/media/a-336.jpg",
      srcset: "https://x.com/uploads/a-336.jpg 336w, https://x.com/uploads/a-648.jpg 648w",
    }));
    expect(src).toBe("https://x.com/uploads/a-648.jpg");
  });

  it("takes the widest candidate that fits, never a huge original", () => {
    const src = bestImageSrc(attrs({ srcset: `a.jpg 800w, b.jpg ${IMAGE_MAX_W}w, c.jpg 4000w` }));
    expect(src).toBe("b.jpg");
  });

  it("takes the narrowest candidate when every one is too wide", () => {
    expect(bestImageSrc(attrs({ srcset: "big.jpg 5000w, bigger.jpg 9000w" }))).toBe("big.jpg");
  });

  // Measured on bbc.com/news: 20 of its 21 srcsets separate candidates with a
  // comma and NO space. Splitting on /,\s+/ leaves the whole set as one
  // candidate, whose descriptor will not parse, so the reader silently took the
  // 240w thumbnail off a set that offers 1536w.
  it("splits candidates separated by a comma with no space", () => {
    const bbc = "https://i.bbci.co.uk/240/a.jpg.webp 240w,https://i.bbci.co.uk/640/a.jpg.webp 640w,"
      + "https://i.bbci.co.uk/1024/a.jpg.webp 1024w,https://i.bbci.co.uk/1536/a.jpg.webp 1536w";
    expect(bestImageSrc(attrs({ srcset: bbc }))).toBe("https://i.bbci.co.uk/1536/a.jpg.webp");
  });

  // The control for the rule above, and the reason a bare-comma split is wrong:
  // techcrunch.com serves Photon URLs whose QUERY holds a comma
  // (?resize=1536,1043). A comma only separates candidates once the URL has
  // ended, i.e. after whitespace.
  it("keeps a comma that is inside the URL itself", () => {
    const tc = "https://tc.com/a.jpg?resize=150,102 150w, https://tc.com/a.jpg?resize=1536,1043 1536w";
    expect(bestImageSrc(attrs({ srcset: tc }))).toBe("https://tc.com/a.jpg?resize=1536,1043");
  });

  it("takes the highest density from a density-only srcset", () => {
    expect(bestImageSrc(attrs({ srcset: "a.jpg, b.jpg 1.5x, c.jpg 2x" }))).toBe("c.jpg");
  });

  it("skips a data: placeholder src in favour of a lazy-load attribute", () => {
    const src = bestImageSrc(attrs({ src: "data:image/gif;base64,R0lGOD", "data-src": "real.jpg" }));
    expect(src).toBe("real.jpg");
  });

  it("falls back to src when nothing better is offered", () => {
    expect(bestImageSrc(attrs({ src: "plain.jpg" }))).toBe("plain.jpg");
  });

  it("answers empty when the only address is a placeholder", () => {
    expect(bestImageSrc(attrs({ src: "data:image/gif;base64,R0lGOD" }))).toBe("");
  });
});

describe("image conversion uses srcset (Reader / Magic)", () => {
  it("the reader converter writes the working upload, not the 404 alias", () => {
    const md = wikiHtmlToMarkdown(`<p>Beneath campus.</p><p>${WP_IMG}</p>`);
    expect(md).toContain("wp-content/uploads/2015/04/tunnel-1200x1600.jpg");
    expect(md).not.toContain("/media/2015/04/");
  });

  it("a figure's image uses srcset too", () => {
    const md = wikiHtmlToMarkdown(`<figure>${WP_IMG}<figcaption>A tunnel</figcaption></figure>`);
    expect(md).toContain("![A tunnel](https://badgerherald.com/wp-content/uploads/2015/04/tunnel-1200x1600.jpg)");
  });

  it("the drag-import converter picks srcset for bare images and figures", () => {
    const bare = htmlToMarkdown(`<p>x</p>${WP_IMG}`, "", { keepImages: true });
    expect(bare).toContain("tunnel-1200x1600.jpg");
    const fig = htmlToMarkdown(`<figure>${WP_IMG}<figcaption>c</figcaption></figure>`, "", { keepFigures: true });
    expect(fig).toContain("tunnel-1200x1600.jpg");
    expect(`${bare}${fig}`).not.toContain("/media/2015/04/");
  });

  it("an image with only src is unchanged", () => {
    const md = wikiHtmlToMarkdown(`<p><img src="https://e.com/a.png" alt="A"></p>`);
    expect(md).toContain("![A](https://e.com/a.png)");
  });
});
