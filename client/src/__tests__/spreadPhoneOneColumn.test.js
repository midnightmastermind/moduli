// On a phone the artifact viewer is one column, and a file's notes go under it (UI sweep 2026-10-20).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.join(__dirname, "../index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("artifact viewer on a phone", () => {
  it("is one column, at a specificity above the [data-count] column rules", () => {
    expect(css).toMatch(/\.artifact-spread--mobile\s+\.artifact-spread-body\[data-count\]\s*\{\s*--spread-cols:\s*1;/);
  });
  it("puts an open file body under the file, not beside it", () => {
    expect(css).toMatch(/\.artifact-spread--mobile \.artifact-spread-body \.instance-wrap:has\(> \.instance-doc-body\) \{ flex-direction: column; \}/);
  });
  it("control: the desktop viewer still puts it beside the file", () => {
    expect(css).toMatch(/\.artifact-spread-body \.instance-wrap:has\(> \.instance-doc-body\) \{\s*display: flex;\s*flex-direction: row;/);
  });
});

describe("a book tile's header in the viewer", () => {
  it("wraps instead of scrolling sideways, so the tile buttons' corner stays clear", () => {
    expect(css).toMatch(/\.artifact-spread \.instance-row\[data-tile-header\] \.book-reader-head \{ flex-wrap: wrap !important; overflow-x: visible !important;/);
  });
  it("the Contents select starts small, so a tile wide enough keeps one row", () => {
    const src = fs.readFileSync(path.join(__dirname, "../modules/BookReader.jsx"), "utf8");
    expect(src).toMatch(/aria-label="Contents"[^\n]*flex: "1 1 72px"/);
  });
});
