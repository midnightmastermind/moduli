// The book reader's header (user, 2026-10-18: one header row). It WRAPS when the pane is narrow: on a phone the
// one row ran Notes / Open in viewer / page / zoom off the right edge with no scrollbar (2026-10-20 (12)). A wide
// pane still holds one row, because the Contents dropdown starts at 72px and is the part that shrinks.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
const src = fs.readFileSync(path.resolve(__dirname, "../modules/BookReader.jsx"), "utf8");
const head = src.slice(src.indexOf('className="book-reader-head"'), src.indexOf('className="book-reader-head"') + 300);
describe("book reader header", () => {
  it("wraps on a narrow pane instead of running off the edge", () => {
    expect(head).toMatch(/flexWrap: "wrap"/);
    expect(head).not.toMatch(/flexWrap: "nowrap"/);
  });
  it("buttons keep their width; the contents dropdown is what shrinks, from a small base", () => {
    expect(src).toMatch(/const navBtn = \{[^}]*flexShrink: 0/);
    expect(src).toMatch(/aria-label="Contents"[^>]*flex: "1 1 72px"[^>]*minWidth: 72/);
  });
});
