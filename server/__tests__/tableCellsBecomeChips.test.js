import { describe, it, expect } from "vitest";
import { cellInline, boldFromMarkdown } from "../migrations/0459-table-cells-become-chips.mjs";

const doc = (...paras) => ({ type: "doc", content: paras.map((c) => ({ type: "paragraph", content: c })) });
describe("0459", () => {
  it("a text cell converts, marks kept", () => {
    expect(cellInline(doc([{ type: "text", text: "Iron", marks: [{ type: "italic" }] }]))).toEqual([{ type: "text", text: "Iron", marks: [{ type: "italic" }] }]);
  });
  it("two paragraphs join with a line break", () => {
    expect(cellInline(doc([{ type: "text", text: "a" }], [{ type: "text", text: "b" }]))).toEqual([{ type: "text", text: "a" }, { type: "hardBreak" }, { type: "text", text: "b" }]);
  });
  it("empty and embed cells are left (controls)", () => {
    expect(cellInline(doc([]))).toBeNull();
    expect(cellInline(doc([{ type: "moduleEmbed", attrs: { occurrenceId: "x" } }]))).toBeNull();
    expect(cellInline(doc([{ type: "instanceTextblockInline", attrs: { occurrenceId: "x" } }]))).toBeNull();
  });
  it("**bold** becomes a bold mark", () => {
    expect(boldFromMarkdown([{ type: "text", text: "**Gnosis** here" }])).toEqual([
      { type: "text", text: "Gnosis", marks: [{ type: "bold" }] }, { type: "text", text: " here" },
    ]);
  });
});
