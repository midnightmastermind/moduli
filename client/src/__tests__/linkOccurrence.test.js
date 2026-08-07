import { describe, it, expect } from "vitest";
import { deriveLinkLabel, linkChipShape } from "../helpers/linkOccurrence";

describe("deriveLinkLabel", () => {
  it("prefers given text", () => {
    expect(deriveLinkLabel("The Eminem Show", "https://x.com/a")).toBe("The Eminem Show");
  });
  it("reads a wiki slug as the article name", () => {
    expect(deriveLinkLabel("", "https://en.wikipedia.org/wiki/The_Eminem_Show")).toBe("The Eminem Show");
  });
  it("decodes percent-encoding", () => {
    expect(deriveLinkLabel("", "https://en.wikipedia.org/wiki/Caf%C3%A9")).toBe("Café");
  });
  it("uses the last path segment and drops an extension", () => {
    expect(deriveLinkLabel("", "https://example.com/docs/getting-started.html")).toBe("getting-started");
  });
  it("falls back to the host on a bare domain — never a raw URL", () => {
    expect(deriveLinkLabel("", "https://www.example.com")).toBe("example.com");
    expect(deriveLinkLabel("", "https://www.example.com/")).toBe("example.com");
  });
  it("never returns empty", () => {
    expect(deriveLinkLabel("", "")).toBe("Link");
  });
});

describe("linkChipShape — the twin of the importer's buildInlineLink", () => {
  const url = "https://en.wikipedia.org/wiki/The_Eminem_Show";

  it("carries meta.link on BOTH halves, in the importer's shape", () => {
    const s = linkChipShape({ url });
    expect(s.meta).toEqual({ link: { kind: "url", url } });
  });

  it("labels the chip from the URL, not with the URL", () => {
    expect(linkChipShape({ url }).label).toBe("The Eminem Show");
  });

  it("writes the label as the body text, like buildInlineLink does", () => {
    expect(linkChipShape({ url }).textmap).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "The Eminem Show" }] }],
    });
  });

  it("is kind 'doc' as a card and 'inline' in a sentence — never 'block'", () => {
    // TextblockCard switches on `kind === "inline"`; "block" is not a value this
    // app uses anywhere, and inventing one renders until something checks it.
    expect(linkChipShape({ url }).kind).toBe("doc");
    expect(linkChipShape({ url, inline: true }).kind).toBe("inline");
  });

  it("mints no ids and no parentage — the mint helper owns those", () => {
    const s = linkChipShape({ url });
    expect(s.id).toBeUndefined();
    expect(s.parentId).toBeUndefined();
  });
});
