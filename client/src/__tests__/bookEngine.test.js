import { describe, it, expect } from "vitest";
import {
  bookEngineFor, mobiDrmStatus, pdfTextToMarkdown, htmlHasText,
  makeReadingPosition, samePosition, positionLabel,
} from "../helpers/bookEngine";

// A minimal MOBI header: PDB header (78 bytes) + one record entry (8 bytes) + record 0 at offset 86.
function mobi({ encryption = 0, magic = "BOOKMOBI" } = {}) {
  const b = new Uint8Array(200);
  for (let i = 0; i < 8; i++) b[60 + i] = magic.charCodeAt(i);
  b[76] = 0; b[77] = 1;               // one record
  b[78] = 0; b[79] = 0; b[80] = 0; b[81] = 86; // record 0 offset = 86
  b[86 + 12] = (encryption >> 8) & 0xff; b[86 + 13] = encryption & 0xff;
  return b;
}

describe("bookEngine", () => {
  it("routes ebook and pdf kinds, nothing else", () => {
    expect(bookEngineFor("ebook")).toBe("ebook");
    expect(bookEngineFor("pdf")).toBe("pdf");
    expect(bookEngineFor("image")).toBe(null);
    expect(bookEngineFor("book")).toBe(null);
  });

  it("reads the PalmDOC encryption field: 0 is open, anything else is locked", () => {
    expect(mobiDrmStatus(mobi({ encryption: 0 }))).toBe("open");
    expect(mobiDrmStatus(mobi({ encryption: 2 }))).toBe("locked");
    expect(mobiDrmStatus(mobi({ encryption: 1 }).buffer)).toBe("locked");
  });

  it("is not-mobi for an EPUB (zip), a short file, or a record 0 past the bytes given", () => {
    const zip = new Uint8Array(200); zip[0] = 0x50; zip[1] = 0x4b;
    expect(mobiDrmStatus(zip)).toBe("not-mobi");
    expect(mobiDrmStatus(new Uint8Array(40))).toBe("not-mobi");
    const far = mobi(); far[80] = 0x10; // offset 0x1056, beyond the 200 bytes
    expect(mobiDrmStatus(far)).toBe("not-mobi");
  });

  it("joins a PDF page's wrapped lines into paragraphs and breaks on a wide gap", () => {
    const at = (str, y, eol = true) => ({ str, transform: [1, 0, 0, 1, 0, y], height: 10, hasEOL: eol });
    const md = pdfTextToMarkdown({ items: [
      at("The first paragraph runs", 700), at("over two lines.", 688),
      at("A second paragraph after a gap.", 650),
      at("It also wraps", 638), at("again.", 626),
    ] });
    expect(md).toBe("The first paragraph runs over two lines.\n\nA second paragraph after a gap. It also wraps again.");
  });

  it("mends a word hyphenated across a line", () => {
    const at = (str, y) => ({ str, transform: [1, 0, 0, 1, 0, y], height: 10, hasEOL: true });
    expect(pdfTextToMarkdown({ items: [at("an extra-", 700), at("ordinary day", 688)] })).toBe("an extraordinary day");
  });

  it("an empty page is empty text, not a crash", () => {
    expect(pdfTextToMarkdown(null)).toBe("");
    expect(pdfTextToMarkdown({ items: [] })).toBe("");
  });

  it("htmlHasText ignores a page that is only an image", () => {
    expect(htmlHasText('<p><img src="cover.jpg"></p>')).toBe(false);
    expect(htmlHasText("<p>Chapter one</p>")).toBe(true);
  });

  it("positions: stored shape, sameness, and the saved page's label", () => {
    const e = makeReadingPosition({ cfi: "epubcfi(/6/4)", fraction: 0.34, now: 0 });
    expect(e).toEqual({ at: "1970-01-01T00:00:00.000Z", cfi: "epubcfi(/6/4)", fraction: 0.34 });
    const p = makeReadingPosition({ page: 12, fraction: 1.4, now: 0 });
    expect(p.page).toBe(12);
    expect(p.fraction).toBe(1);
    expect(samePosition(p, { page: 12 })).toBe(true);
    expect(samePosition(p, { page: 13 })).toBe(false);
    expect(samePosition(null, p)).toBe(false);
    expect(positionLabel("Dune", p)).toBe("Dune — p. 12");
    expect(positionLabel("Dune", e)).toBe("Dune — 34%");
    expect(positionLabel("", null)).toBe("Book");
  });
});
