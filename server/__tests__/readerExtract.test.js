// Reader mode's extraction and its "is this worth showing" threshold.
//
// User: *"can you make sure to open in text preview mode if possible"* — and
// "possible" is doing real work. Measured through THIS extractor over fourteen
// of the user's own bookmarks: reddit 0 words, viafluere 0, scribd 35, then
// nothing at all until blog.spl.org at 542. The threshold sits in that gap.
import { describe, it, expect } from "vitest";
import { wordCount, readerIsUsable, READER_MIN_WORDS } from "../utils/readerExtract.js";

describe("wordCount", () => {
  it("counts prose", () => expect(wordCount("one two three")).toBe(3));

  it("keeps link TEXT and drops the target", () => {
    // A URL is not prose. Counting it would make a page of links look readable.
    expect(wordCount("see [the docs](https://example.com/a/very/long/path) now")).toBe(4);
  });

  it("drops fenced code", () => {
    expect(wordCount("intro\n```\nlots of code here indeed\n```\nend")).toBe(2);
  });

  it("drops images entirely", () => {
    expect(wordCount("before ![some alt text](https://x/y.png) after")).toBe(2);
  });

  it("a non-string is 0, not a crash", () => {
    expect(wordCount(null)).toBe(0);
    expect(wordCount(undefined)).toBe(0);
  });
});

describe("readerIsUsable", () => {
  it("rejects the three that measured as shells", () => {
    // reddit 0 · viafluere 0 · scribd 35 — real pages that return a JS shell.
    for (const w of [0, 0, 35]) expect(readerIsUsable(w)).toBe(false);
  });

  it("accepts the ten that measured as articles", () => {
    for (const w of [542, 599, 638, 964, 1011, 4278, 4897, 4965, 6106, 11429]) {
      expect(readerIsUsable(w)).toBe(true);
    }
  });

  it("sits in the GAP, with margin on both sides", () => {
    // The highest shell was 35 and the lowest article 542. A threshold inside a
    // cluster is arbitrary; this one has to be wrong by 165 words before it
    // misclassifies anything that was measured.
    expect(READER_MIN_WORDS).toBeGreaterThan(35);
    expect(READER_MIN_WORDS).toBeLessThan(542);
  });

  it("a missing count is not usable — fails to the live site", () => {
    // If the fetch threw or returned nothing, the honest answer is the frame,
    // not an empty reader.
    expect(readerIsUsable(undefined)).toBe(false);
    expect(readerIsUsable(null)).toBe(false);
  });
});
