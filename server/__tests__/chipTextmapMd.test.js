// __tests__/chipTextmapMd.test.js
//
// Migration 0337. 0333 cleaned the chip's module LABEL and verified "0 left" on
// that field; the chip renders `textmapToInlineText(occurrence.textmap)`, so the
// `***` stayed on screen. These tests are about the field the renderer reads.
import { describe, it, expect } from "vitest";
import { stripTextmapMd } from "../migrations/0337-link-chip-textmaps-carry-raw-markdown.mjs";

const doc = (...text) => ({
  type: "doc",
  content: [{ type: "paragraph", content: text.map((t) => ({ type: "text", text: t })) }],
});

describe("stripTextmapMd", () => {
  // The exact text measured on poms grid 2026-09-17.
  it("clears the bold-italic run the user reported", () => {
    const res = stripTextmapMd(doc("***The Book: On the Taboo Against Knowing Who You Are***"));
    expect(res.changed).toBe(1);
    expect(res.textmap.content[0].content[0].text).toBe("The Book: On the Taboo Against Knowing Who You Are");
  });

  it("clears a single-word emphasis run", () => {
    expect(stripTextmapMd(doc("*Billboard* 200")).textmap.content[0].content[0].text).toBe("Billboard 200");
  });

  // THE NARROWING, and it is what keeps this to 21 rows instead of 297: the
  // stripper also trims, and `textmapToInlineText` already collapses whitespace
  // before painting, so a leading space is not a defect to rewrite prose over.
  it("leaves a row whose only difference is whitespace", () => {
    expect(stripTextmapMd(doc(" — the big regions of your screen."))).toBeNull();
  });

  it("returns null for clean text, so the write is skipped", () => {
    expect(stripTextmapMd(doc("The Book: On the Taboo Against Knowing Who You Are"))).toBeNull();
    expect(stripTextmapMd(null)).toBeNull();
  });

  it("reaches every text node, not just the first", () => {
    const res = stripTextmapMd(doc("*one*", " plain ", "**two**"));
    expect(res.changed).toBe(2);
    expect(res.textmap.content[0].content.map((n) => n.text)).toEqual(["one", " plain ", "two"]);
  });

  // The chip's LINK and every other node are untouched — only the text it prints.
  it("does not disturb non-text nodes", () => {
    const tm = {
      type: "doc",
      content: [
        { type: "image", attrs: { src: "https://x/**y**.jpg" } },
        { type: "paragraph", content: [{ type: "text", text: "*a*" }] },
      ],
    };
    const res = stripTextmapMd(tm);
    expect(res.textmap.content[0]).toEqual(tm.content[0]);
    expect(res.textmap.content[1].content[0].text).toBe("a");
  });
});
