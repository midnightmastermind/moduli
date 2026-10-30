// A textblock's read-only stand-in: drawn from plain text, or none at all when plain text cannot stand in
// (user 2026-10-30: Basic Nutrition Guide's bullet lists of chips showed EMPTY until clicked).
import { describe, it, expect } from "vitest";
import { standInBlocks } from "../helpers/lazyEditor";

const p = (...c) => ({ type: "paragraph", content: c });
const t = (text) => ({ type: "text", text });

describe("standInBlocks", () => {
  it("plain paragraphs stand in as their text (control)", () => {
    expect(standInBlocks({ type: "doc", content: [p(t("Hello")), p(t("world"))] })).toEqual(["Hello", "world"]);
  });
  it("a bullet list of mini textblocks cannot — the editor mounts instead of an empty box", () => {
    const tm = { type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: [p({ type: "instanceTextblockInline", attrs: { occurrenceId: "x" } })] }] }] };
    expect(standInBlocks(tm)).toBeNull();
  });
  it("a chip inside prose cannot either (its words live in its own occurrence)", () => {
    expect(standInBlocks({ type: "doc", content: [p(t("see "), { type: "instanceTextblockInline", attrs: { occurrenceId: "x" } })] })).toBeNull();
  });
  it("tables and pictures cannot", () => {
    expect(standInBlocks({ type: "doc", content: [{ type: "table", content: [] }] })).toBeNull();
    expect(standInBlocks({ type: "doc", content: [{ type: "image", attrs: { src: "a" } }] })).toBeNull();
  });
  it("no textmap is an empty stand-in", () => {
    expect(standInBlocks(null)).toEqual([]);
  });
});
