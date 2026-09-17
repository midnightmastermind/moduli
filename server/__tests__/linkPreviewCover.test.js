// A BOOKMARK MADE IN THE APP HAD NO PICTURE AND NO NAME.
//
// User, 2026-09-16: *"we should either grabbing a wikipedia logo or the first
// image for wikipedia article bookmarks. the cover image i mean."*
//
// MEASURED ON THE LIVE GRID BEFORE ANYTHING WAS WRITTEN, and the scope is not
// what the request sounds like:
//
//     bookmark modules          1472
//       with a cover            1464
//       NO cover                   8      <- 3 reddit, 1 wikipedia, 1 youtube,
//                                            1 wapo, 1 chopra, 1 blank browser
//     wikipedia bookmarks         39      (38 covered, 1 not)
//
// So this is not a wikipedia problem. Migration `0201` scopes itself to rows
// carrying `meta.raindropId`, so it covered the 1,464 IMPORTED bookmarks and
// has never once covered a bookmark created IN THE APP — and a re-run of it
// plans zero fetches, which is how that stayed invisible. The same gap is why
// all 8 are labelled by a bare host: nothing fetched their title either.
//
// AND THE FALLBACK THE REQUEST ASKS FOR IS NOT NEEDED FOR THE WIKIPEDIA CASE.
// Fetched today, that article answers with an og:image — the same infobox photo
// the reader now lifts. The cover was never missing for want of a rule; nothing
// ever asked the page.
//
// `fetchLinkPreview` already fetches the page for the title, so the cover costs
// no second request, and it uses `coverFromHtml` — the SAME extractor that
// produced all 1,464 existing covers — rather than a second opinion about what
// a page's picture is.
import { describe, it, expect } from "vitest";
import { fetchLinkPreview } from "../utils/linkPreview.js";

const html = (head) => `<html><head>${head}</head><body><p>hi</p></body></html>`;
const fetcher = (body, url = "https://example.com/a") =>
  async () => ({ ok: true, url, html: body });

describe("fetchLinkPreview carries the cover", () => {
  it("returns the page's og:image", async () => {
    const out = await fetchLinkPreview("https://example.com/a", {
      fetchPageHtml: fetcher(html(`
        <title>A Real Title</title>
        <meta property="og:image" content="https://cdn.example.com/hero.jpg">`)),
    });
    expect(out.ok).toBe(true);
    expect(out.title).toBe("A Real Title");
    expect(out.cover).toBe("https://cdn.example.com/hero.jpg");
    expect(out.coverVia).toBe("og");
  });

  it("resolves a relative og:image against the page", async () => {
    const out = await fetchLinkPreview("https://example.com/deep/a", {
      fetchPageHtml: fetcher(html(`<meta property="og:image" content="/img/hero.png">`),
        "https://example.com/deep/a"),
    });
    expect(out.cover).toBe("https://example.com/img/hero.png");
  });

  // A PAGE THAT DECLARES NOTHING FALLS BACK TO THE SITE'S ICON, and that is not
  // a gap — it is precisely what the user asked for: *"either grabbing a
  // wikipedia logo OR the first image"*. `coverFromHtml` already shipped that
  // preference order for migration 0201 (measured there: 55 og:image, 151 a
  // declared icon, 231 a guessed /favicon.ico), so the request needed no new
  // rule — only for something to ASK the page.
  //
  // MY FIRST VERSION OF THIS TEST ASSERTED `null` HERE and failed. The
  // expectation was wrong, not the code.
  it("falls back to the site icon when the page declares no picture", async () => {
    const out = await fetchLinkPreview("https://example.com/a", {
      fetchPageHtml: fetcher(html(`<title>Bare</title>`)),
    });
    expect(out.ok).toBe(true);
    expect(out.title).toBe("Bare");
    expect(out.cover).toBe("https://example.com/favicon.ico");
    expect(out.coverVia).toBe("origin-favicon");
  });

  // THE PREFERENCE ORDER IS THE CONTRACT. Without this, "it has a cover" is
  // satisfied by a function that always returns the favicon — which would put a
  // 16px site icon on a board where the article's own photo was available.
  it("prefers the page's own image over the site icon", async () => {
    const out = await fetchLinkPreview("https://example.com/a", {
      fetchPageHtml: fetcher(html(`
        <link rel="icon" href="/fav.png">
        <meta property="og:image" content="https://cdn.example.com/hero.jpg">`)),
    });
    expect(out.cover).toBe("https://cdn.example.com/hero.jpg");
    expect(out.coverVia).toBe("og");
  });

  // The title and favicon are what this function already promised. A cover must
  // not have cost them — this is the regression control for the existing
  // callers (the drop/paste intake path).
  it("still returns the title and favicon it always did", async () => {
    const out = await fetchLinkPreview("https://example.com/a", {
      fetchPageHtml: fetcher(html(`
        <title>Kept</title>
        <link rel="icon" href="/fav.png">`)),
    });
    expect(out.title).toBe("Kept");
    expect(out.favicon).toBe("https://example.com/fav.png");
  });

  it("an unreachable page is still a clean failure, not a throw", async () => {
    const out = await fetchLinkPreview("https://nope.example", {
      fetchPageHtml: async () => { throw new Error("ENOTFOUND"); },
    });
    expect(out.ok).toBe(false);
    expect(out.cover).toBeUndefined();
  });
});
