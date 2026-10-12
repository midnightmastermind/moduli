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

describe("layout breaks inside one tesseract paragraph", () => {
  const at = (text, y0, h) => ({ text, bbox: { x0: 0, y0, x1: 100, y1: y0 + h } });
  // The picnic flyer, as tesseract grouped it on prod: title, prose and a sub-heading in ONE paragraph.
  // Lines packed tight (4px apart) so only the SIZE rule can split them; the gap rule has its own case.
  const flyer = page(para([at("Weekend Picnic Plan", 40, 52), at("We meet at the lake on Saturday", 96, 24),
    at("until the afternoon.", 124, 24), at("Shopping List", 152, 34)]),
  para([at("Body text body text.", 400, 24)]), para([at("More body text.", 440, 24)]));
  it("splits where the line height jumps", () => {
    expect(ocrParagraphs(flyer).map((p) => p.lines.map((l) => l.text).join(" | "))).toEqual([
      "Weekend Picnic Plan", "We meet at the lake on Saturday | until the afternoon.", "Shopping List",
      "Body text body text.", "More body text.",
    ]);
  });
  it("so Magic finds the title and the sub-heading", () => {
    const md = ocrToMarkdown(flyer, { mode: "magic" }).split("\n").filter(Boolean);
    expect(md[0]).toBe("# Weekend Picnic Plan");
    expect(md[1]).toBe("We meet at the lake on Saturday until the afternoon.");
    expect(md[2]).toBe("## Shopping List");
  });
  it("keeps ordinary line spacing together, even next to a short line", () => {
    // The real lines from the picnic flyer: same type, but the second has no descenders, so its BOX is
    // 18px against 23px. tesseract's rowHeight (23 / 23.29) is what says they are the same size.
    const row = (text, y0, y1, rowHeight) => ({ text, bbox: { x0: 0, y0, x1: 100, y1 }, rowAttributes: { rowHeight } });
    const p = page(para([row("If it rains we will move everything to the shelter", 442, 465, 23), row("near the boat house.", 474, 492, 23.289568)]));
    expect(ocrParagraphs(p).map((x) => x.lines.length)).toEqual([2]);
  });
  it("splits at a gap wider than a line, even at the same size", () => {
    const p = page(para([at("one", 0, 20), at("two", 22, 20), at("three", 80, 20)]));
    expect(ocrParagraphs(p).map((x) => x.lines.length)).toEqual([2, 1]);
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
  it("keeps each bullet on its own line (its own paragraph — one textblock reads a single newline as a space)", () => {
    expect(ocrToMarkdown(page(para([line("• eggs"), line("• milk")])), { mode: "reader" })).toBe("• eggs\n\n• milk");
    expect(ocrToMarkdown(page(para([line("• eggs")]), para([line("• milk")])), { mode: "reader" })).toBe("• eggs\n\n• milk");
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
  it("joins bullets tesseract split into separate paragraphs into one list", () => {
    const p = page(para([line("- eggs")]), para([line("- milk")]), para([line("Then cook.")]), ...body());
    expect(ocrToMarkdown(p, { mode: "magic" })).toMatch(/^- eggs\n- milk\n\nThen cook\./);
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
