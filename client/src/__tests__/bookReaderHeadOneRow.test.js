// The book reader's header is ONE row (user, 2026-10-18). In a viewer tile it wrapped:
// the Contents dropdown is as wide as its longest chapter, and the row was flex-wrap.
// It stays one row now; the dropdown shrinks and the buttons do not.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
const src = fs.readFileSync(path.resolve(__dirname, "../modules/BookReader.jsx"), "utf8");
const head = src.slice(src.indexOf('className="book-reader-head"'), src.indexOf('className="book-reader-head"') + 300);
describe("book reader header", () => {
  it("does not wrap", () => {
    expect(head).toMatch(/flexWrap: "nowrap"/);
    expect(head).not.toMatch(/flexWrap: "wrap"/);
  });
  it("buttons keep their width; the contents dropdown is what shrinks", () => {
    expect(src).toMatch(/const navBtn = \{[^}]*flexShrink: 0/);
    expect(src).toMatch(/aria-label="Contents"[^>]*minWidth: 72/);
  });
});
