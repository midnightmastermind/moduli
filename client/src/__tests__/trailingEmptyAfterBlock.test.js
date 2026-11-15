// A doc container's LAST empty line (after a final block) is its hover line: hidden at rest, revealed on hover so you
// can type below the block (index.css). Two of them showed as a blank space under the Glossary's Web & dev links, and
// the read-only stand-in drew even one as a blank line (2026-11-15). Saving keeps at most ONE; the stand-in shows none.
import { describe, it, expect } from "vitest";
import { trimTrailingEmptyAfterBlock } from "../docs/trailingEmpty";

const block = { type: "instanceTextblock", attrs: { occurrenceId: "t" } };
const empty = { type: "paragraph" };
const text = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });

describe("trimTrailingEmptyAfterBlock", () => {
  it("keeps one empty line after a final block (the hover line)", () => {
    expect(trimTrailingEmptyAfterBlock({ type: "doc", content: [block, empty, empty] }, 1)).toEqual({ type: "doc", content: [block, empty] });
  });
  it("keep 0 drops them all (what the stand-in draws)", () => {
    expect(trimTrailingEmptyAfterBlock({ type: "doc", content: [block, empty] }, 0)).toEqual({ type: "doc", content: [block] });
  });
  it("one line already is left alone", () => {
    const doc = { type: "doc", content: [block, empty] };
    expect(trimTrailingEmptyAfterBlock(doc, 1)).toBe(doc);
  });
  it("keeps empty lines after text (someone left a blank line on purpose)", () => {
    const doc = { type: "doc", content: [text("hi"), empty, empty] };
    expect(trimTrailingEmptyAfterBlock(doc, 0)).toBe(doc);
  });
  it("keeps an empty line that is the whole doc", () => {
    const doc = { type: "doc", content: [empty] };
    expect(trimTrailingEmptyAfterBlock(doc, 0)).toBe(doc);
  });
  it("keeps empty lines between blocks", () => {
    const doc = { type: "doc", content: [block, empty, block] };
    expect(trimTrailingEmptyAfterBlock(doc, 0)).toBe(doc);
  });
  it("a paragraph holding only a hard break is not empty", () => {
    const doc = { type: "doc", content: [block, { type: "paragraph", content: [{ type: "hardBreak" }] }] };
    expect(trimTrailingEmptyAfterBlock(doc, 0)).toBe(doc);
  });
});

describe("ensureHoverLine", () => {
  it("a doc ending in a block gets exactly one empty line", async () => {
    const { ensureHoverLine } = await import("../docs/trailingEmpty");
    expect(ensureHoverLine({ type: "doc", content: [block] })).toEqual({ type: "doc", content: [block, empty] });
    expect(ensureHoverLine({ type: "doc", content: [block, empty, empty] })).toEqual({ type: "doc", content: [block, empty] });
    const t = { type: "doc", content: [text("x")] };
    expect(ensureHoverLine(t)).toBe(t);
  });
});
