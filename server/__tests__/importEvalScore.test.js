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

import { compareToBaseline } from "../eval/imports/score.js";
describe("compareToBaseline", () => {
  const base = { a: { total: 0.8, parts: { quotes: 1, chars: 0.6 } }, b: { total: 1, parts: { chars: 1 } } };
  const good = { a: { total: 0.8, parts: { quotes: 1, chars: 0.6 } }, b: { total: 1, parts: { chars: 1 } } };
  it("passes when unchanged", () => expect(compareToBaseline(good, base).ok).toBe(true));
  it("fails when one part regresses though the total rises", () => {
    const r = compareToBaseline({ ...good, a: { total: 0.9, parts: { quotes: 0, chars: 1 } } }, base);
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/a\.quotes/);
  });
  it("fails when a baseline case is missing on a full run, not with only", () => {
    const { b, ...rest } = good;
    expect(compareToBaseline(rest, base).problems.join()).toMatch(/b: in baseline/);
    expect(compareToBaseline(rest, base, { only: "a" }).ok).toBe(true);
  });
  it("fails when a case carries a warning", () => {
    const r = compareToBaseline({ ...good, a: { ...good.a, warnings: ["cutAfter marker not found"] } }, base);
    expect(r.ok).toBe(false);
  });
});
