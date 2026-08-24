// The one decision the Wikipedia quick-add tile makes.
import { describe, it, expect } from "vitest";
import { wikipediaUrlOf, canImportAsPage, pageTitleOf, buildWikipediaImport } from "../helpers/wikipediaPage.js";

const hit = (over = {}) => ({ provider: "wikipedia", title: "Inception",
  url: "https://en.wikipedia.org/wiki/Inception", ...over });

describe("wikipediaUrlOf", () => {
  it("takes an article url", () => {
    expect(wikipediaUrlOf(hit())).toBe("https://en.wikipedia.org/wiki/Inception");
  });
  it("takes any language and the mobile host", () => {
    expect(wikipediaUrlOf(hit({ url: "https://de.wikipedia.org/wiki/Inception" }))).toBeTruthy();
    expect(wikipediaUrlOf(hit({ url: "https://en.m.wikipedia.org/wiki/Inception" }))).toBeTruthy();
  });
  it("REFUSES a url that is not Wikipedia — the button promised otherwise", () => {
    // The discriminating case. This tile is labelled Wikipedia; importing
    // evil.example.com under it is a page the user did not ask for.
    expect(wikipediaUrlOf(hit({ url: "https://evil.example.com/wiki/Inception" }))).toBeNull();
    // and a host that merely ENDS with the right letters
    expect(wikipediaUrlOf(hit({ url: "https://notwikipedia.org/wiki/X" }))).toBeNull();
    expect(wikipediaUrlOf(hit({ url: "https://wikipedia.org.evil.com/wiki/X" }))).toBeNull();
  });
  it("refuses http rather than upgrading it — a silent upgrade is a guess", () => {
    expect(wikipediaUrlOf(hit({ url: "http://en.wikipedia.org/wiki/Inception" }))).toBeNull();
  });
  it("refuses a result with no url — a title alone cannot be imported", () => {
    expect(wikipediaUrlOf(hit({ url: null }))).toBeNull();
    expect(wikipediaUrlOf(hit({ url: "   " }))).toBeNull();
    expect(wikipediaUrlOf(null)).toBeNull();
  });
  it("survives junk without throwing", () => {
    expect(wikipediaUrlOf(hit({ url: "not a url" }))).toBeNull();
    expect(canImportAsPage({})).toBe(false);
  });
});

describe("pageTitleOf", () => {
  it("uses the provider's title", () => expect(pageTitleOf(hit())).toBe("Inception"));
  it("falls back to the path segment, underscores and all", () => {
    expect(pageTitleOf(hit({ title: "", url: "https://en.wikipedia.org/wiki/The_Matrix" })))
      .toBe("The Matrix");
  });
  it("decodes a percent-escaped title", () => {
    expect(pageTitleOf(hit({ title: "", url: "https://en.wikipedia.org/wiki/Caf%C3%A9" })))
      .toBe("Café");
  });
  it("NEVER returns an empty name — a blank label renders as a blank tree row", () => {
    expect(pageTitleOf({ title: "", url: null })).toBe("Untitled");
    expect(pageTitleOf(hit({ title: "  ", url: "https://en.wikipedia.org/" }))).toBe("Untitled");
  });
});

// ── WHAT LEAVES THE MENU ───────────────────────────────────────────────────
//
// 2026-08-11 (5): an op was verified by driving the callee for months while the
// CALLER passed a single object into a positional function — feature dead, every
// test green. So the payload is built by a pure function and asserted here.
describe("buildWikipediaImport", () => {
  const ok = { provider: "wikipedia", title: "Inception", url: "https://en.wikipedia.org/wiki/Inception" };

  it("carries the url, the title and the host as the parent", () => {
    expect(buildWikipediaImport(ok, { gridId: "g1", hostOccurrence: { id: "occ7" } }))
      .toEqual({ gridId: "g1", url: "https://en.wikipedia.org/wiki/Inception",
                 title: "Inception", parentId: "occ7" });
  });

  it("a null host is legal — the import lands in the server's default home", () => {
    expect(buildWikipediaImport(ok, { gridId: "g1" }).parentId).toBeNull();
  });

  it("refuses without a gridId, rather than emitting a request that cannot land", () => {
    expect(buildWikipediaImport(ok, { gridId: null })).toBeNull();
  });

  it("refuses a non-Wikipedia result — the gate is on the PAYLOAD, not just the list", () => {
    // The discriminating case: filtering the rendered list is not enough if the
    // click path would still send it.
    expect(buildWikipediaImport({ ...ok, url: "https://evil.example.com/x" }, { gridId: "g1" })).toBeNull();
  });
});
