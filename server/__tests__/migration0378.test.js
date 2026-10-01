import { describe, it, expect } from "vitest";
import { headingAbove, looksLikeFileName } from "../migrations/0378-doc-image-labels-from-headings.mjs";
describe("0378", () => {
  const doc = { type: "doc", content: [
    { type: "heading", content: [{ type: "text", text: "1. Nigredo — " }, { type: "text", text: "Blackening" }] },
    { type: "paragraph", content: [{ type: "text", text: "x" }] },
    { type: "moduleEmbed", attrs: { occurrenceId: "a" } },
    { type: "heading", content: [{ type: "text", text: "2. Albedo" }] },
    { type: "moduleEmbed", attrs: { occurrenceId: "b" } },
  ] };
  it("names a picture by the nearest heading above it", () => {
    expect(headingAbove(doc, "a")).toBe("1. Nigredo — Blackening");
    expect(headingAbove(doc, "b")).toBe("2. Albedo");
  });
  it("a picture with no heading above gets nothing", () => {
    expect(headingAbove({ type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "c" } }] }, "c")).toBe("");
  });
  // The control: only file-name labels are replaced.
  it("recognises a file-name label, not a real one", () => {
    expect(looksLikeFileName("1*OuJfHWDdGrnZlwK52J2HnA.jpeg")).toBe(true);
    expect(looksLikeFileName("Rosa Alba")).toBe(false);
  });
});
