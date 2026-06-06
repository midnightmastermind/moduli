import { describe, it, expect } from "vitest";
import { wikiTitleFromHref, relinkTextmap, relinkOccurrences } from "../services/importRelink.js";

describe("importRelink — wikiTitleFromHref", () => {
  it("extracts the article title from a wiki href, ignoring anchors/queries", () => {
    expect(wikiTitleFromHref("https://en.wikipedia.org/wiki/Dr._Dre")).toBe("Dr. Dre");
    expect(wikiTitleFromHref("https://en.wikipedia.org/wiki/D12_(band)#History")).toBe("D12 (band)");
    expect(wikiTitleFromHref("https://example.com/x")).toBeNull();
    expect(wikiTitleFromHref("")).toBeNull();
  });
});

describe("importRelink — relinkTextmap", () => {
  const tm = (href, text = "Dr. Dre") => ({
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        { type: "text", text: "See " },
        { type: "text", text, marks: [{ type: "link", attrs: { href } }] },
        { type: "text", text: " now." },
      ],
    }],
  });

  it("converts an imported article's link mark into a docLink node", () => {
    const { textmap, changed } = relinkTextmap(
      tm("https://en.wikipedia.org/wiki/Dr._Dre"),
      { "Dr. Dre": "occ-dre" }
    );
    expect(changed).toBe(true);
    const nodes = textmap.content[0].content;
    const dl = nodes.find((n) => n.type === "docLink");
    expect(dl.attrs).toEqual({ targetId: "occ-dre", label: "Dr. Dre", linkType: "doc" });
    // surrounding text untouched
    expect(nodes[0]).toEqual({ type: "text", text: "See " });
    expect(nodes[2]).toEqual({ type: "text", text: " now." });
  });

  it("leaves links to NON-imported articles as external link marks", () => {
    const { textmap, changed } = relinkTextmap(
      tm("https://en.wikipedia.org/wiki/Snoop_Dogg"),
      { "Dr. Dre": "occ-dre" }
    );
    expect(changed).toBe(false);
    expect(textmap.content[0].content.some((n) => n.type === "docLink")).toBe(false);
  });

  it("matches case-insensitively and recurses into bulletList items", () => {
    const textmap = {
      type: "doc",
      content: [{
        type: "bulletList",
        content: [{
          type: "listItem",
          content: [{ type: "paragraph", content: [
            { type: "text", text: "Eminem", marks: [{ type: "link", attrs: { href: "https://en.wikipedia.org/wiki/Eminem" } }] },
          ] }],
        }],
      }],
    };
    const { changed, textmap: out } = relinkTextmap(textmap, { "eminem": "occ-em" });
    expect(changed).toBe(true);
    const dl = out.content[0].content[0].content[0].content[0];
    expect(dl).toEqual({ type: "docLink", attrs: { targetId: "occ-em", label: "Eminem", linkType: "doc" } });
  });

  it("no-ops with an empty map or non-object textmap", () => {
    expect(relinkTextmap(tm("https://en.wikipedia.org/wiki/Dr._Dre"), {}).changed).toBe(false);
    expect(relinkTextmap(null, { x: "y" }).changed).toBe(false);
  });
});

describe("importRelink — relinkOccurrences", () => {
  it("returns only the occurrences whose textmap changed", () => {
    const occs = [
      { id: "a", textmap: { type: "doc", content: [{ type: "paragraph", content: [
        { type: "text", text: "x", marks: [{ type: "link", attrs: { href: "https://en.wikipedia.org/wiki/Dr._Dre" } }] }] }] } },
      { id: "b", textmap: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "plain" }] }] } },
      { id: "c" }, // no textmap
    ];
    const changed = relinkOccurrences(occs, { "Dr. Dre": "occ-dre" });
    expect(changed.map((o) => o.id)).toEqual(["a"]);
  });
});
