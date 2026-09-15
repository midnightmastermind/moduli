import { describe, it, expect } from "vitest";
import { bestImageSrc, wikiHtmlToMarkdown, htmlToMarkdown, IMAGE_MAX_W } from "../services/wikipediaTools.js";

// Reader and Magic mode showed broken images on badgerherald.com: WordPress
// put a 404 alias in `src` and the working uploads in `srcset`. The markup below
// is that article's shape, trimmed.
const WP_IMG = `<img decoding="async" src="https://badgerherald.com/media/2015/04/tunnel-336x448.jpg" alt="Tunnel" srcset="https://badgerherald.com/wp-content/uploads/2015/04/tunnel-336x448.jpg 336w, https://badgerherald.com/wp-content/uploads/2015/04/tunnel-648x864.jpg 648w, https://badgerherald.com/wp-content/uploads/2015/04/tunnel-1200x1600.jpg 1200w, https://badgerherald.com/wp-content/uploads/2015/04/tunnel-3000x4000.jpg 3000w" sizes="(max-width: 336px) 100vw, 336px">`;
const attrs = (o) => (n) => (n in o ? o[n] : null);

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
