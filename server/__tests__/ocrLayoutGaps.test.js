import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { ocrParagraphs, ocrToMarkdown, fixOcrCharacters } from "../utils/ocrLayout.js";

const gnosis = JSON.parse(fs.readFileSync(new URL("../eval/imports/cases/gnosis/ocr.json", import.meta.url), "utf8"));

describe("ocrParagraphs on the photographed Gnosis card", () => {
  const { paragraphs } = ocrParagraphs(gnosis);
  const text = (p) => p.lines.map((l) => l.text).join(" ");
  const body = paragraphs.filter((p) => p.kind !== "heading");
  it("finds at least four non-heading paragraphs", () => {
    expect(body.length).toBeGreaterThanOrEqual(4);
  });
  it("breaks after the line ending in a colon and mends the split paragraph", () => {
    expect(text(paragraphs[2]).startsWith("The knowledge")).toBe(true);
    expect(text(paragraphs[3]).startsWith("The tradition")).toBe(true);
    expect(text(paragraphs[3])).toMatch(/arts, and religions\.$/);
  });
  it("reads the last block as a quote with its attribution", () => {
    const q = paragraphs[paragraphs.length - 1];
    expect(q.kind).toBe("quote");
    expect(q.attribution).toBe("C. G. Jung");
  });
  it("writes the quote as markdown", () => {
    const md = ocrToMarkdown(gnosis, { mode: "magic" });
    expect(md).toMatch(/> [“"]I know! I don't need to believe\.[”"]\n> — C\. G\. Jung$/);
  });
});

describe("fixOcrCharacters", () => {
  it("turns a standalone bar into I", () => {
    expect(fixOcrCharacters('"I know! | don\'t need')).toBe('"I know! I don\'t need');
  });
  it("leaves a bar inside a word or a double bar alone", () => {
    expect(fixOcrCharacters("a|b")).toBe("a|b");
    expect(fixOcrCharacters("x || y")).toBe("x || y");
  });
});

describe("no over-splitting", () => {
  it("keeps six evenly spaced lines in one block as one paragraph", () => {
    const lines = Array.from({ length: 6 }, (_, i) => ({
      text: `line number ${i} of the text`,
      bbox: { x0: 10, y0: i * 22, x1: 400, y1: i * 22 + 20 },
      rowAttributes: { rowHeight: 20 },
    }));
    const page = { text: "", blocks: [{ bbox: { x0: 10, y0: 0, x1: 400, y1: 132 }, paragraphs: [{ lines, confidence: 90 }] }] };
    expect(ocrParagraphs(page).paragraphs.length).toBe(1);
  });
});
