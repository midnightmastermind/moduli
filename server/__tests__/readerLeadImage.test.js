import { describe, it, expect } from "vitest";
import { leadImageFromHtml } from "../services/wikipediaTools.js";
import { readerFromHtml } from "../utils/readerExtract.js";

// THE READER SHOWED A WIKIPEDIA ARTICLE WITH NO PICTURES AT ALL.
//
// User, on their own bookmark: "i clicked on a wikipedia bookmark and it didnt
// have any images brought over in reader mode or magic mode." Measured on that
// exact article (Albert Ellis) through the REAL chain:
//
//     raw HTML 10 <img>  ->  extractMainContent 2  ->  markdown 0
//
// and on Eminem, 28 -> 14 -> 10. The difference is not the converter: Eminem's
// body is full of inline figures, and Albert Ellis's ONLY content image is the
// one in its infobox. `WIKI_STRIP_SELECTORS` removes `.infobox` wholesale — it
// is a metadata table, and dumping born/died/education into a reader would be
// worse than dropping it — so the picture goes with the box.
//
// `fullMarkdown` (the IMPORT path) already knows this and says so in its own
// comment: "Wikipedia's main photo lives in the .infobox, which
// wikiHtmlToMarkdown strips, so the article body has no main image." It fixes it
// by asking the REST summary API. The READER never got the equivalent — the
// twin-drift class this repo has paid for repeatedly — and it cannot simply copy
// that fix: the reader holds only the page HTML it already fetched, runs against
// any site rather than en.wikipedia, and sits inside a latency budget where a
// second network round trip is exactly what the 2026-09-10 (2) retraction was
// about.
//
// So the picture is LIFTED OUT of the box before the box is stripped.

// Albert Ellis's shape, trimmed: one infobox holding the lead photo, and a body
// that carries no image of its own.
const INFOBOX_ONLY = `
<div id="mw-content-text">
  <table class="infobox biography vcard">
    <tbody>
      <tr><td colspan="2"><span typeof="mw:File">
        <img src="//thumb.wikimedia.org/wikipedia/commons/thumb/7/7c/Photo_of_Albert_Ellis_on_dust_jacket.jpg/250px-Photo_of_Albert_Ellis_on_dust_jacket.jpg" decoding="async" width="250" height="333">
      </span></td></tr>
      <tr><th scope="row">Born</th><td>September 27, 1913</td></tr>
      <tr><th scope="row">Alma mater</th><td>Columbia University</td></tr>
    </tbody>
  </table>
  <p>Albert Ellis was an American psychologist who founded rational emotive behavior therapy.</p>
</div>`;

describe("leadImageFromHtml — the picture inside a stripped infobox", () => {
  it("finds the lead photo", () => {
    expect(leadImageFromHtml(INFOBOX_ONLY))
      .toBe("https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7c/Photo_of_Albert_Ellis_on_dust_jacket.jpg/250px-Photo_of_Albert_Ellis_on_dust_jacket.jpg");
  });

  // Measured across seven real articles (Albert Ellis, Eminem, Carl Rogers,
  // Aaron Beck, Sigmund Freud, Marie Curie, Tokyo): the lead photo is the WIDEST
  // infobox image every time — 250px on the biographies, 288 on Tokyo's montage
  // — while a signature trails at 150 and chrome icons sit at 20-40. Taking the
  // FIRST image instead would pick a country article's flag over its map, and a
  // fixed pixel threshold would be a guess; "widest" needs neither.
  it("prefers the widest image, not the first one in the box", () => {
    const withSignature = `
      <table class="infobox">
        <tr><td><img src="https://x/sig.png" width="150"></td></tr>
        <tr><td><img src="https://x/portrait.jpg" width="250"></td></tr>
      </table>`;
    expect(leadImageFromHtml(withSignature)).toBe("https://x/portrait.jpg");
  });

  // The floor only ever decides an infobox that holds NOTHING but chrome. Real
  // photos measured 57-288px wide and icons 20-40, so 60 sits in that gap.
  it("returns nothing when the box holds only icons", () => {
    const iconsOnly = `
      <table class="infobox">
        <tr><td><img src="https://x/Information_icon4.svg.png" width="20"></td></tr>
        <tr><td><img src="https://x/Symbol_category_class.svg.png" width="20"></td></tr>
      </table>`;
    expect(leadImageFromHtml(iconsOnly)).toBe(null);
  });

  // The rule names one container on purpose. A `.navbox` or `.sidebar` is
  // navigation chrome whose images are flags and icons; lifting out of those
  // would put a thumbnail of something the article merely LINKS TO at its head.
  it("does not lift out of a navbox", () => {
    const nav = `<div class="navbox"><img src="https://x/flag.png" width="250"></div>`;
    expect(leadImageFromHtml(nav)).toBe(null);
  });

  it("answers null for markup with no infobox at all", () => {
    expect(leadImageFromHtml("<p>plain</p>")).toBe(null);
    expect(leadImageFromHtml("")).toBe(null);
  });

  // `src` alone is not enough — the reason `bestImageSrc` exists at all.
  it("reads the address the element OFFERS, not just src", () => {
    const srcset = `
      <table class="infobox"><tr><td>
        <img src="https://x/tiny.jpg" width="250"
             srcset="https://x/500.jpg 500w, https://x/1000.jpg 1000w">
      </td></tr></table>`;
    expect(leadImageFromHtml(srcset)).toBe("https://x/1000.jpg");
  });
});

describe("readerFromHtml — the article keeps its picture", () => {
  it("carries the infobox photo into the markdown", () => {
    const { markdown } = readerFromHtml(INFOBOX_ONLY, "Albert Ellis");
    expect(markdown).toMatch(/!\[[^\]]*\]\(https:\/\/thumb\.wikimedia\.org\/[^)]*Albert_Ellis[^)]*\)/);
  });

  // THE CONTROL, and it is the whole reason this is a lift rather than dropping
  // `.infobox` from the strip list: the box's METADATA must still be gone.
  it("still strips the infobox's metadata table", () => {
    const { markdown } = readerFromHtml(INFOBOX_ONLY, "Albert Ellis");
    expect(markdown).not.toContain("Alma mater");
    expect(markdown).not.toContain("September 27, 1913");
    expect(markdown).toContain("rational emotive behavior therapy");
  });

  // An article whose body already carries the picture must not show it twice.
  it("does not duplicate an image the body already has", () => {
    const both = `
      <div id="mw-content-text">
        <table class="infobox"><tr><td><img src="https://x/photo.jpg" width="250"></td></tr></table>
        <figure><img src="https://x/photo.jpg" srcset="https://x/photo.jpg 800w"><figcaption>A caption</figcaption></figure>
        <p>Body text that is long enough to matter.</p>
      </div>`;
    const { markdown } = readerFromHtml(both, "Dup");
    expect(markdown.match(/https:\/\/x\/photo\.jpg/g)).toHaveLength(1);
  });

  // THE REGRESSION CONTROL: an article with real body figures and no infobox is
  // untouched. Without this, "the reader has images" would also be satisfied by
  // a change that injected something into every page.
  it("leaves an article with body figures alone", () => {
    const body = `
      <div id="mw-content-text">
        <figure><img src="https://x/body.jpg" srcset="https://x/body.jpg 900w"><figcaption>Cap</figcaption></figure>
        <p>Body text that is long enough to matter.</p>
      </div>`;
    const { markdown } = readerFromHtml(body, "Body");
    expect(markdown).toContain("https://x/body.jpg");
    expect(markdown.match(/!\[/g)).toHaveLength(1);
  });
});
