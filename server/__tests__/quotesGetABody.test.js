import { describe, it, expect } from "vitest";
import { quoteBody } from "../migrations/0495-quotes-get-a-body.mjs";

const walk = (n, out = []) => { if (!n) return out; out.push(n); (n.content || []).forEach((c) => walk(c, out)); return out; };

describe("0495 quoteBody", () => {
  it("links become link chips, bold and italic become marks", () => {
    const { textmap, chips } = quoteBody("**[annotation]** The *Last Supper*. — [Wikipedia: X](https://en.wikipedia.org/wiki/X) · [Search](https://g.co/?q=x)");
    const nodes = walk(textmap);
    expect(chips.map((c) => c.url)).toEqual(["https://en.wikipedia.org/wiki/X", "https://g.co/?q=x"]);
    expect(nodes.filter((n) => n.type === "instanceTextblockInline").map((n) => n.attrs.occurrenceId)).toEqual(chips.map((c) => c.occurrenceId));
    expect(nodes.some((n) => n.type === "text" && n.marks?.some((m) => m.type === "italic") && n.text === "Last Supper")).toBe(true);
    expect(JSON.stringify(textmap)).not.toContain("**");
  });
  it("blank-line paragraphs stay paragraphs; a quote with no links mints nothing", () => {
    const { textmap, chips } = quoteBody("one\n\ntwo");
    expect(textmap.content.map((p) => p.type)).toEqual(["paragraph", "paragraph"]);
    expect(chips).toEqual([]);
  });
});
