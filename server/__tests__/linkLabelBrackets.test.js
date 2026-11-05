// A link whose label holds brackets, the shape Wikipedia's IPA templates give: [[ˈbɒnsaɪ]](url). It printed as raw markdown.
import { describe, it, expect } from "vitest";
import { markdownToReaderDoc } from "../services/markdownImporter.js";

const textOf = (n) => (n.text || "") + (n.content || []).map(textOf).join("");

describe("a link label with brackets in it", () => {
  it("is a link, and no url is left in the text", () => {
    const doc = markdownToReaderDoc("Bonsai [[bonsai]](https://en.wikipedia.org/wiki/Help:IPA/Japanese) is an art.");
    const t = textOf(doc.doc || doc);
    expect(t).not.toMatch(/https?:|\]\(/);
    expect(t).toContain("[bonsai]");
  });
  it("still leaves a plain link and bracketed prose alone", () => {
    const t = textOf((d => d.doc || d)(markdownToReaderDoc("see [a](https://x.y/z) and [note] here")));
    expect(t).toContain("see a and [note] here");
  });
});
