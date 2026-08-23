// The cover image of a web page. Pure, so the PREFERENCE ORDER and the refusals
// are settled without spending any of the 437 outbound requests on finding out.
import { describe, it, expect } from "vitest";
import { coverFromHtml, isUsableCoverUrl, absolutize, originFaviconFor } from "../utils/pageCover.js";

const PAGE = "https://example.com/articles/one?x=1";

describe("isUsableCoverUrl", () => {
  it("accepts http and https", () => {
    expect(isUsableCoverUrl("http://a.com/i.png")).toBe(true);
    expect(isUsableCoverUrl("https://a.com/i.png")).toBe(true);
  });
  it("REFUSES a data: URI even though it parses", () => {
    // The ones in the wild are 1x1 tracking pixels and inline spinners, stored
    // in full on the row — a picture of nothing, at document-bloating size.
    expect(isUsableCoverUrl("data:image/gif;base64,R0lGODlhAQABAAAAACw=")).toBe(false);
  });
  it("refuses javascript:, empty and junk", () => {
    expect(isUsableCoverUrl("javascript:alert(1)")).toBe(false);
    expect(isUsableCoverUrl("")).toBe(false);
    expect(isUsableCoverUrl("   ")).toBe(false);
    expect(isUsableCoverUrl(null)).toBe(false);
  });
});

describe("absolutize", () => {
  it("resolves a root-relative reference against the page", () => {
    expect(absolutize("/img/a.png", PAGE)).toBe("https://example.com/img/a.png");
  });
  it("resolves a path-relative reference against the page's directory", () => {
    expect(absolutize("a.png", PAGE)).toBe("https://example.com/articles/a.png");
  });
  it("resolves a protocol-relative reference", () => {
    expect(absolutize("//cdn.com/a.png", PAGE)).toBe("https://cdn.com/a.png");
  });
  it("leaves an absolute reference alone", () => {
    expect(absolutize("https://cdn.com/a.png", PAGE)).toBe("https://cdn.com/a.png");
  });
});

describe("coverFromHtml", () => {
  it("takes og:image", () => {
    const r = coverFromHtml('<meta property="og:image" content="https://cdn.com/og.png">', PAGE);
    expect(r).toEqual({ url: "https://cdn.com/og.png", via: "og" });
  });

  it("PREFERS og:image over twitter:image and over an icon", () => {
    // Order is the whole contract here: a page that declares all three has one
    // right answer, and it is the one every other link preview shows.
    const html = `
      <link rel="apple-touch-icon" href="/touch.png">
      <meta name="twitter:image" content="https://cdn.com/tw.png">
      <meta property="og:image" content="https://cdn.com/og.png">`;
    expect(coverFromHtml(html, PAGE).url).toBe("https://cdn.com/og.png");
  });

  it("falls to twitter:image when there is no og:image", () => {
    const r = coverFromHtml('<meta name="twitter:image" content="/tw.png">', PAGE);
    expect(r).toEqual({ url: "https://example.com/tw.png", via: "og" });
  });

  it("SKIPS an unusable og:image and keeps looking, rather than giving up", () => {
    // A page whose og:image is a data-URI spinner still has a real picture
    // further down; stopping at the first MATCH instead of the first USABLE one
    // would throw that away.
    const html = `
      <meta property="og:image" content="data:image/gif;base64,R0lGODlh">
      <meta name="twitter:image" content="https://cdn.com/tw.png">`;
    expect(coverFromHtml(html, PAGE).url).toBe("https://cdn.com/tw.png");
  });

  it("prefers apple-touch-icon over favicon — 180px reads as a picture, 16px as a break", () => {
    const html = `<link rel="icon" href="/fav.ico"><link rel="apple-touch-icon" href="/touch.png">`;
    expect(coverFromHtml(html, PAGE)).toEqual({ url: "https://example.com/touch.png", via: "icon" });
  });

  it("guesses the origin favicon when the page declares NOTHING", () => {
    const r = coverFromHtml("<html><body>nothing here</body></html>", PAGE);
    expect(r).toEqual({ url: "https://example.com/favicon.ico", via: "origin-favicon" });
  });

  it("reports HOW it found one, so a pass can say 'real cover' vs 'icon'", () => {
    expect(coverFromHtml('<meta property="og:image" content="https://c/o.png">', PAGE).via).toBe("og");
    expect(coverFromHtml('<link rel="icon" href="/f.ico">', PAGE).via).toBe("icon");
    expect(coverFromHtml("", PAGE).via).toBe("origin-favicon");
  });

  it("returns null when even the origin cannot be formed — the control", () => {
    expect(coverFromHtml('<meta property="og:image" content="https://c/o.png">', "not a url")).toBeTruthy();
    expect(coverFromHtml("<html></html>", "not a url")).toBeNull();
  });
});

describe("originFaviconFor", () => {
  it("drops the path and the query", () => {
    expect(originFaviconFor(PAGE)).toBe("https://example.com/favicon.ico");
  });
  it("refuses a non-http scheme", () => {
    expect(originFaviconFor("ftp://example.com/x")).toBeNull();
    expect(originFaviconFor("nonsense")).toBeNull();
  });
});
