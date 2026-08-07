// server/__tests__/importRelinkChips.test.js
//
// Task 6 of docs/superpowers/plans/2026-08-06-intake-links-and-artifacts.md.
//
// THE GAP: `relinkTextmap` rewrites inline link MARKS, but since 2026-06-06 the
// importer emits each prose link as its own mini-textblock carrying `meta.link`
// — so the mark-based relink never touches anything imported today, which is why
// every chip on the existing Eminem page still opens wikipedia.org.
//
// The case that matters most here is the LAST group: a chip that does not match
// must come back BYTE-IDENTICAL. A wrong resolution sends the reader to the
// wrong page, which is worse than leaving the link on the web.
import { describe, it, expect } from "vitest";
import {
  wikiTitleFromHref, collectLinkChips, relinkLinkChips,
} from "../services/importRelink.js";

const chip = (id, url, extraMeta = {}) => ({
  id, role: "textblock", kind: "inline",
  meta: { link: { kind: "url", url }, ...extraMeta },
});

describe("wikiTitleFromHref — every URL form resolves to ONE title", () => {
  const cases = [
    ["https://en.wikipedia.org/wiki/Dr._Dre", "Dr. Dre"],
    ["https://en.wikipedia.org/wiki/Dr._Dre#Career", "Dr. Dre"],
    ["https://en.wikipedia.org/wiki/Dr._Dre?action=raw", "Dr. Dre"],
    ["/wiki/Dr._Dre", "Dr. Dre"],
    ["https://en.wikipedia.org/wiki/Caf%C3%A9", "Café"],
    ["https://fr.wikipedia.org/wiki/Paris", "Paris"],
  ];
  for (const [href, title] of cases) {
    it(`${href} → ${title}`, () => expect(wikiTitleFromHref(href)).toBe(title));
  }

  it("returns null for a non-wiki URL", () => {
    expect(wikiTitleFromHref("https://example.com/wiki-ish")).toBeNull();
    expect(wikiTitleFromHref("")).toBeNull();
  });
});

describe("collectLinkChips", () => {
  it("finds chips still pointing OUT at a URL", () => {
    const occs = [
      chip("c1", "https://en.wikipedia.org/wiki/Eminem"),
      { id: "t1", role: "textblock", meta: {} },
      { id: "t2", role: "textblock" },
    ];
    expect(collectLinkChips(occs).map(c => c.id)).toEqual(["c1"]);
  });

  it("EXCLUDES an already-converted chip, so a second run is a no-op", () => {
    const occs = [{ id: "c1", meta: { link: { kind: "occurrence", occId: "page-1" } } }];
    expect(collectLinkChips(occs)).toEqual([]);
  });

  it("survives a malformed link object", () => {
    const occs = [{ id: "c1", meta: { link: { kind: "url" } } }, { id: "c2", meta: { link: "nope" } }];
    expect(collectLinkChips(occs)).toEqual([]);
  });
});

describe("relinkLinkChips", () => {
  const imported = { "Dr. Dre": "occ-dre", "50 Cent": "occ-50" };

  it("rewrites a chip whose URL matches an imported page", () => {
    const occs = [chip("c1", "https://en.wikipedia.org/wiki/Dr._Dre")];
    const { changes, matched } = relinkLinkChips(occs, imported);
    expect(matched).toBe(1);
    expect(changes).toEqual([{ id: "c1", meta: { link: { kind: "occurrence", occId: "occ-dre" } } }]);
  });

  it("matches on the TITLE, so anchors and underscores converge on one page", () => {
    const occs = [
      chip("c1", "https://en.wikipedia.org/wiki/Dr._Dre#Career"),
      chip("c2", "/wiki/Dr._Dre"),
    ];
    const { changes } = relinkLinkChips(occs, imported);
    expect(changes.map(c => c.meta.link.occId)).toEqual(["occ-dre", "occ-dre"]);
  });

  it("is case-insensitive on the title but EXACT — no fuzzy matching", () => {
    const { matched: hit } = relinkLinkChips([chip("c1", "/wiki/dr._dre")], imported);
    expect(hit).toBe(1);
    // "Dr. Dre discography" is a DIFFERENT article. Resolving it to Dr. Dre
    // would send the reader somewhere they did not ask to go.
    const { matched: miss, changes } = relinkLinkChips(
      [chip("c2", "/wiki/Dr._Dre_discography")], imported,
    );
    expect(miss).toBe(0);
    expect(changes).toEqual([]);
  });

  it("leaves an UNIMPORTED chip byte-identical — it is absent from the result", () => {
    const occs = [chip("c1", "https://en.wikipedia.org/wiki/Nas")];
    const { changes, unmatched } = relinkLinkChips(occs, imported);
    expect(changes).toEqual([]);
    expect(unmatched).toBe(1);
    // and the input was not mutated
    expect(occs[0].meta.link).toEqual({ kind: "url", url: "https://en.wikipedia.org/wiki/Nas" });
  });

  it("counts a non-wiki link separately from an unmatched one", () => {
    const { skippedNonWiki, unmatched } = relinkLinkChips([
      chip("c1", "https://example.com/blog"),
      chip("c2", "/wiki/Nas"),
    ], imported);
    expect(skippedNonWiki).toBe(1);
    expect(unmatched).toBe(1);
  });

  it("refuses a chip that resolves to ITSELF — that is a loop, not a link", () => {
    const { changes, unmatched } = relinkLinkChips(
      [chip("occ-dre", "/wiki/Dr._Dre")], imported,
    );
    expect(changes).toEqual([]);
    expect(unmatched).toBe(1);
  });

  it("MERGES meta rather than replacing it", () => {
    // A chip carries more than its link; a whole-meta write would drop it.
    const occs = [chip("c1", "/wiki/Dr._Dre", { sourceUrl: "https://x", headingLevel: 2 })];
    const { changes } = relinkLinkChips(occs, imported);
    expect(changes[0].meta).toEqual({
      sourceUrl: "https://x", headingLevel: 2,
      link: { kind: "occurrence", occId: "occ-dre" },
    });
  });

  it("accepts a Map as well as an object", () => {
    const { matched } = relinkLinkChips(
      [chip("c1", "/wiki/Dr._Dre")], new Map([["Dr. Dre", "occ-dre"]]),
    );
    expect(matched).toBe(1);
  });

  it("writes nothing when the map is empty", () => {
    expect(relinkLinkChips([chip("c1", "/wiki/Dr._Dre")], {}).changes).toEqual([]);
  });
});
