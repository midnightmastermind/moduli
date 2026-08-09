// __tests__/harvestLinks.test.js
//
// The harvester's whole job is DECIDING which links are worth offering, so the
// tests are weighted to the refusals — a link wrongly kept costs the user a
// fetch and a checkbox, a link wrongly dropped is a page they cannot import.
import { describe, it, expect } from "vitest";
import { extractLinks, normalizeLinkUrl, HARVEST_LINK_CAP } from "../utils/harvestLinks.js";

const BASE = "https://example.com/articles/one";

describe("normalizeLinkUrl", () => {
  it("resolves a relative href against the page it came from", () => {
    expect(normalizeLinkUrl("/two", BASE)).toBe("https://example.com/two");
    expect(normalizeLinkUrl("two", BASE)).toBe("https://example.com/articles/two");
  });

  it("drops the fragment but KEEPS the query — ?page=2 is a different document", () => {
    expect(normalizeLinkUrl("/a?page=2#top", BASE)).toBe("https://example.com/a?page=2");
  });

  it("refuses anything that is not http(s)", () => {
    expect(normalizeLinkUrl("mailto:a@b.com", BASE)).toBeNull();
    expect(normalizeLinkUrl("javascript:alert(1)", BASE)).toBeNull();
    expect(normalizeLinkUrl("tel:+15551234", BASE)).toBeNull();
  });

  it("returns null for an unresolvable href instead of throwing", () => {
    expect(normalizeLinkUrl("", BASE)).toBeNull();
    expect(normalizeLinkUrl("http://", BASE)).toBeNull();
  });
});

describe("extractLinks", () => {
  it("lists outbound links in document order with their anchor text", () => {
    const html = `
      <p>See <a href="/two">The second one</a> and
      <a href="https://other.example/x">Another site</a>.</p>`;
    const { links } = extractLinks(html, BASE);
    expect(links).toEqual([
      { url: "https://example.com/two", label: "The second one" },
      { url: "https://other.example/x", label: "Another site" },
    ]);
  });

  it("EXCLUDES the page itself, including bare in-page anchors", () => {
    // A long article's table of contents is dozens of these; every one of them
    // would import the page we are already importing.
    const html = `
      <a href="#section-1">Jump</a>
      <a href="${BASE}">This page</a>
      <a href="${BASE}#later">This page again</a>
      <a href="/real">A real one</a>`;
    const { links } = extractLinks(html, BASE);
    expect(links.map((l) => l.url)).toEqual(["https://example.com/real"]);
  });

  it("dedupes repeated links and keeps the FIRST anchor text", () => {
    const html = `<a href="/two">First wording</a><a href="/two#x">Second wording</a>`;
    const { links } = extractLinks(html, BASE);
    expect(links).toEqual([{ url: "https://example.com/two", label: "First wording" }]);
  });

  it("refuses URLs whose path is obviously a file, not a page", () => {
    const html = `
      <a href="/a.pdf">Report</a>
      <a href="/b.png">Chart</a>
      <a href="/c.zip">Bundle</a>
      <a href="/keep">Keep me</a>`;
    const { links } = extractLinks(html, BASE);
    expect(links.map((l) => l.url)).toEqual(["https://example.com/keep"]);
  });

  it("keeps an extensionless URL and one whose QUERY merely mentions a file", () => {
    // The extension test reads the path; a `?download=x.zip` query says nothing
    // about what the page is. Dropping these would lose real articles.
    const html = `<a href="/page">A</a><a href="/dl?file=x.zip">B</a>`;
    const { links } = extractLinks(html, BASE);
    expect(links.map((l) => l.url)).toEqual([
      "https://example.com/page",
      "https://example.com/dl?file=x.zip",
    ]);
  });

  it("falls back to the URL's last path segment when the anchor has no text", () => {
    const html = `<a href="/deep/getting-started"><img src="/i.png"></a>`;
    const { links } = extractLinks(html, BASE);
    expect(links[0].label).toBe("getting started");
  });

  it("collapses whitespace in the anchor text", () => {
    const html = `<a href="/two">  The\n  second\tone  </a>`;
    expect(extractLinks(html, BASE).links[0].label).toBe("The second one");
  });

  it("caps the list and REPORTS what it dropped rather than showing a short one", () => {
    const html = Array.from({ length: 12 }, (_, i) => `<a href="/p${i}">P${i}</a>`).join("");
    const { links, truncated, total } = extractLinks(html, BASE, { max: 5 });
    expect(links).toHaveLength(5);
    expect(total).toBe(12);
    expect(truncated).toBe(true);
  });

  it("does not report truncation when everything fit", () => {
    const html = `<a href="/a">A</a><a href="/b">B</a>`;
    const { truncated, total } = extractLinks(html, BASE, { max: 5 });
    expect(truncated).toBe(false);
    expect(total).toBe(2);
  });

  it("has a default cap, so a hub page cannot produce an unbounded list", () => {
    const html = Array.from({ length: HARVEST_LINK_CAP + 20 }, (_, i) =>
      `<a href="/p${i}">P${i}</a>`).join("");
    const { links, truncated } = extractLinks(html, BASE);
    expect(links).toHaveLength(HARVEST_LINK_CAP);
    expect(truncated).toBe(true);
  });

  it("returns an empty result for empty or unparseable input rather than throwing", () => {
    expect(extractLinks("", BASE)).toEqual({ links: [], truncated: false, total: 0 });
    expect(extractLinks(null, BASE)).toEqual({ links: [], truncated: false, total: 0 });
    expect(extractLinks("<p>no links here</p>", BASE).links).toEqual([]);
  });
});
