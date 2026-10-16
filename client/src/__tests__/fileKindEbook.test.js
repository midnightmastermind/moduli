// The client's upload classifier agrees with the server's on book files (user, 2026-10-16).
import { describe, it, expect } from "vitest";
import { mimeToKind } from "../helpers/fileKind";

describe("mimeToKind (client)", () => {
  it("a book file is an ebook", () => {
    expect(mimeToKind("application/epub+zip", "x.epub")).toBe("ebook");
    expect(mimeToKind("", "x.azw3")).toBe("ebook");
    expect(mimeToKind("application/x-mobipocket-ebook", "x.mobi")).toBe("ebook");
  });
  it("controls: notes and pdfs are unchanged", () => {
    expect(mimeToKind("text/markdown", "notes.md")).toBe("markdown");
    expect(mimeToKind("application/pdf", "a.pdf")).toBe("pdf");
  });
});
