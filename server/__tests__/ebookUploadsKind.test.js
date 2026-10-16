// 0406: a book file uploaded before the classifier knew books is recognised by what it IS.
import { describe, it, expect } from "vitest";
import { isMisfiledEbook } from "../migrations/0406-ebook-uploads-kind.mjs";

describe("isMisfiledEbook", () => {
  it("an artifact whose file is an e-book, stored under another kind", () => {
    expect(isMisfiledEbook({ role: "artifact", kind: "markdown", meta: { mimeType: "application/epub+zip", originalName: "x.epub" } })).toBe(true);
    expect(isMisfiledEbook({ role: "artifact", kind: "markdown", meta: { originalName: "Book.AZW3" } })).toBe(true);
  });
  it("controls: already an ebook, a real note, a pdf, not an artifact", () => {
    expect(isMisfiledEbook({ role: "artifact", kind: "ebook", meta: { originalName: "x.epub" } })).toBe(false);
    expect(isMisfiledEbook({ role: "artifact", kind: "markdown", meta: { originalName: "notes.md", mimeType: "text/markdown" } })).toBe(false);
    expect(isMisfiledEbook({ role: "artifact", kind: "pdf", meta: { mimeType: "application/pdf", originalName: "a.pdf" } })).toBe(false);
    expect(isMisfiledEbook({ role: "instance", kind: "markdown", meta: { originalName: "x.epub" } })).toBe(false);
  });
});
