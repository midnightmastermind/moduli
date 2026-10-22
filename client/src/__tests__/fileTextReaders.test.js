// @vitest-environment jsdom
// In-place readers for text files (user, 2026-10-22: "we should show the book reader and have a code
// reader as well. csv should be a table already ... markdown as well"). The file is kept as a file; what
// it shows is read from the file itself.
import { describe, it, expect } from "vitest";
import { fileReaderKind, parseDelimited, langForFile, renderMarkdownSafe } from "../modules/FileTextReaders.jsx";

describe("fileReaderKind — which reader a file gets", () => {
  it("names tables, markdown and plain text by the file's own name", () => {
    expect(fileReaderKind("markdown", "data.csv")).toBe("csv");
    expect(fileReaderKind("markdown", "data.TSV")).toBe("tsv");
    expect(fileReaderKind("markdown", "notes.md")).toBe("markdown");
    expect(fileReaderKind("markdown", "readme.markdown")).toBe("markdown");
    expect(fileReaderKind("markdown", "log.txt")).toBe("text");
  });
  it("code, books and pdfs by kind", () => {
    expect(fileReaderKind("code", "a.js")).toBe("code");
    expect(fileReaderKind("pdf", "a.pdf")).toBe("book");
    expect(fileReaderKind("ebook", "a.epub")).toBe("book");
  });
  // Control: "markdown" is also the catch-all kind for ANY unknown upload (docx, zip…). Fetching those
  // as text would paint binary garbage, so only named text formats get a reader.
  it("an unknown file under the catch-all kind gets no reader", () => {
    expect(fileReaderKind("markdown", "report.docx")).toBe(null);
    expect(fileReaderKind("markdown", "archive.zip")).toBe(null);
    expect(fileReaderKind("markdown", "")).toBe(null);
    expect(fileReaderKind("image", "a.png")).toBe(null);
  });
});

describe("parseDelimited", () => {
  it("splits rows and cells, honours quotes, doubled quotes and CRLF", () => {
    const rows = parseDelimited('name,note\r\n"Smith, J","said ""hi"""\r\nAda,\n', ",");
    expect(rows).toEqual([["name", "note"], ["Smith, J", 'said "hi"'], ["Ada", ""]]);
  });
  it("a quoted cell may hold a newline", () => {
    expect(parseDelimited('a,b\n"x\ny",z', ",")).toEqual([["a", "b"], ["x\ny", "z"]]);
  });
  it("tabs for tsv", () => {
    expect(parseDelimited("a\tb\n1\t2", "\t")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("langForFile", () => {
  // A Drive file's ref is gdrive:<conn>:<id> — no extension. The ORIGINAL name carries it.
  it("reads the language from the original name before the ref", () => {
    expect(langForFile("script.py", "gdrive:c:abc")).toBe("python");
    expect(langForFile(null, "user/2026-10/x.ts")).toBe("typescript");
    expect(langForFile(null, "gdrive:c:abc")).toBe(null);
  });
});

describe("renderMarkdownSafe", () => {
  it("renders markdown and strips anything that could run", async () => {
    const html = await renderMarkdownSafe("# Title\n\n**bold** <script>alert(1)</script> <img src=x onerror=alert(1)>");
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onerror/i);
  });
});
