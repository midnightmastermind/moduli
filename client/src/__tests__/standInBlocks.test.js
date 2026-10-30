// A textblock's read-only stand-in: drawn from plain text, or none at all when plain text cannot stand in
// (user 2026-10-30: Basic Nutrition Guide's bullet lists of chips showed EMPTY until clicked).
import { describe, it, expect } from "vitest";
import { standInBlocks } from "../helpers/lazyEditor";

const p = (...c) => ({ type: "paragraph", content: c });
const t = (text) => ({ type: "text", text });

describe("standInBlocks", () => {
  it("plain paragraphs stand in as their nodes (control)", () => {
    const tm = { type: "doc", content: [p(t("Hello")), p(t("world"))] };
    expect(standInBlocks(tm)).toEqual(tm.content);
  });
  it("a bullet list of mini textblocks is drawn (the chips by the doc chip component) — no eager editor", () => {
    const tm = { type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: [p({ type: "instanceTextblockInline", attrs: { occurrenceId: "x" } })] }] }] };
    expect(standInBlocks(tm)).toEqual(tm.content);
  });
  it("marks and line breaks are drawable", () => {
    const tm = { type: "doc", content: [p({ type: "text", text: "a", marks: [{ type: "bold" }] }, { type: "hardBreak" })] };
    expect(standInBlocks(tm)).not.toBeNull();
  });
  it("tables, pictures and embeds are not — the editor mounts", () => {
    expect(standInBlocks({ type: "doc", content: [{ type: "table", content: [] }] })).toBeNull();
    expect(standInBlocks({ type: "doc", content: [{ type: "image", attrs: { src: "a" } }] })).toBeNull();
    expect(standInBlocks({ type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "x" } }] })).toBeNull();
  });
  it("no textmap is an empty stand-in", () => {
    expect(standInBlocks(null)).toEqual([]);
  });
});
