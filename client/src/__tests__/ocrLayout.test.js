import { describe, it, expect } from "vitest";
import { joinLines, ocrParagraphs, ocrToMarkdown } from "../helpers/ocrLayout";

const line = (text, h = 20) => ({ text, bbox: { x0: 0, y0: 0, x1: 100, y1: h } });
const para = (lines, confidence = 90) => ({ lines, confidence });
const page = (...paras) => ({ text: "", blocks: [{ paragraphs: paras }] });

describe("joinLines", () => {
  it("joins wrapped lines into one line of prose", () => {
    expect(joinLines(["The quick brown", "fox jumps"])).toBe("The quick brown fox jumps");
  });
  it("mends a word hyphenated across a line break", () => {
    expect(joinLines(["an extra-", "ordinary infor-", "mation"])).toBe("an extraordinary information");
  });
  it("keeps a hyphen before a capitalised word (a real compound)", () => {
    expect(joinLines(["New-", "York"])).toBe("New- York");
  });
});

describe("ocrParagraphs", () => {
  it("drops low-confidence specks", () => {
    const p = page(para([line("·")], 20), para([line("Real text here")]));
    expect(ocrParagraphs(p).map((x) => x.lines[0].text)).toEqual(["Real text here"]);
  });
});

describe("ocrToMarkdown — reader", () => {
  it("keeps paragraphs apart and lines within them together", () => {
    const p = page(para([line("First line of the"), line("first paragraph.")]), para([line("Second paragraph.")]));
    expect(ocrToMarkdown(p, { mode: "reader" })).toBe("First line of the first paragraph.\n\nSecond paragraph.");
  });
  it("makes no headings, even from a tall line", () => {
    const p = page(para([line("Big Title", 60)]), para([line("Body text body text.")]), para([line("More body.")]));
    expect(ocrToMarkdown(p, { mode: "reader" })).not.toMatch(/^#/m);
  });
  it("keeps bullets as their own lines", () => {
    const p = page(para([line("• eggs"), line("• milk")]));
    expect(ocrToMarkdown(p, { mode: "reader" })).toBe("• eggs\n• milk");
  });
  it("escapes markdown that OCR happened to read", () => {
    const p = page(para([line("# 1 in the charts")]));
    expect(ocrToMarkdown(p, { mode: "reader" })).toBe("\\# 1 in the charts");
  });
  it("falls back to the plain text when there is no layout", () => {
    expect(ocrToMarkdown({ text: "one\ntwo\n\nthree", blocks: null }, { mode: "reader" })).toBe("one two\n\nthree");
  });
  it("returns empty for a picture with no words", () => {
    expect(ocrToMarkdown({ text: "", blocks: [] })).toBe("");
  });
});

describe("ocrToMarkdown — magic", () => {
  const body = () => [para([line("Body text body text.")]), para([line("More body text.")]), para([line("Even more body.")])];
  it("makes a tall line a heading", () => {
    const p = page(para([line("Big Title", 40)]), ...body());
    expect(ocrToMarkdown(p, { mode: "magic" }).split("\n")[0]).toBe("# Big Title");
  });
  it("makes a moderately tall line a sub-heading", () => {
    const p = page(para([line("Section", 27)]), ...body());
    expect(ocrToMarkdown(p, { mode: "magic" }).split("\n")[0]).toBe("## Section");
  });
  it("makes a short line ending in a colon a minor heading", () => {
    const p = page(para([line("Ingredients:")]), ...body());
    expect(ocrToMarkdown(p, { mode: "magic" }).split("\n")[0]).toBe("### Ingredients");
  });
  it("turns bullets into a list, joining a wrapped item", () => {
    const p = page(para([line("- eggs"), line("- milk and"), line("cream")]), ...body());
    expect(ocrToMarkdown(p, { mode: "magic" })).toMatch(/^- eggs\n- milk and cream/);
  });
  it("keeps a numbered list numbered", () => {
    const p = page(para([line("1. preheat"), line("2. bake")]), ...body());
    expect(ocrToMarkdown(p, { mode: "magic" })).toMatch(/^1\. preheat\n2\. bake/);
  });
  it("never turns a long paragraph into a heading", () => {
    const p = page(para([line("a", 40), line("b", 40), line("c", 40), line("d", 40)]), ...body());
    expect(ocrToMarkdown(p, { mode: "magic" })).not.toMatch(/^#/m);
  });
});
