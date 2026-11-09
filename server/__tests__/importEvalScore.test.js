import { describe, it, expect } from "vitest";
import { scoreCase } from "../eval/imports/score.js";

const MD = "# Title\n\nFirst paragraph of words here.\n\nSecond paragraph of other words.";

describe("scoreCase", () => {
  it("identical markdown scores 1 on paragraphs", () => {
    const r = scoreCase({ expectedMd: MD, actualMd: MD });
    expect(r.parts.paragraphs).toBe(1);
    expect(r.total).toBeCloseTo(1, 5);
  });
  it("merging two paragraphs lowers paragraphs", () => {
    const merged = "# Title\n\nFirst paragraph of words here. Second paragraph of other words.";
    expect(scoreCase({ expectedMd: MD, actualMd: merged }).parts.paragraphs).toBeLessThan(1);
  });
  it("a quote read as a plain paragraph scores 0 on quotes", () => {
    const e = "Intro text.\n\n> I know the way\n> — Jung";
    const a = "Intro text.\n\nI know the way\n\n— Jung";
    expect(scoreCase({ expectedMd: e, actualMd: a }).parts.quotes).toBe(0);
  });
  it("char errors reduce chars partially", () => {
    const r = scoreCase({ expectedMd: "I know", actualMd: "| know" });
    expect(r.parts.chars).toBeGreaterThan(0.8);
    expect(r.parts.chars).toBeLessThan(1);
  });
  it("absent title expectation is omitted", () => {
    const r = scoreCase({ expectedMd: MD, actualMd: MD, expectedMeta: {}, actualMeta: { title: "x" } });
    expect(r.parts.title).toBeUndefined();
  });
  it("imageKept expected but no images scores 0", () => {
    const r = scoreCase({ expectedMd: MD, actualMd: MD, expectedMeta: { imageKept: true }, actualMeta: { images: [] } });
    expect(r.parts.imageKept).toBe(0);
  });
});
