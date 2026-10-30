import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// A top-level line in a doc that mints must be as tall as the textblock it becomes, or every click
// on an empty line moves the lines below it (user 2026-10-20). Measured in a browser: 43.7px both.
const css = fs.readFileSync(path.join(__dirname, "..", "index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("doc lines are textblock-sized", () => {
  const rule = css.match(/\.doc-editor--mints \.doc-editor-content\.ProseMirror > p:not\(\.doc-container:not\(\.doc-editor--mints\) \*\):not\(\.table-td \*\) \{([^}]*)\}/);
  it("exists, scoped to docs that mint and kept out of a textblock's own body", () => {
    expect(rule).toBeTruthy();
  });
  it("uses the textblock's text size, line height and spacing", () => {
    const body = rule[1];
    // The doc text size since 2026-10-30 (was the 17px label size) — the same size a textblock's body takes.
    expect(body).toMatch(/font-size:\s*var\(--cascade-font-size,\s*var\(--doc-text-px,\s*12px\)\)/);
    expect(body).toMatch(/line-height:\s*var\(--doc-text-line,\s*1\.35\)/);
    expect(body).toMatch(/padding-block:\s*calc\(4px \+ 0\.25em\)/);
    expect(body).toMatch(/margin-block:\s*3px/);
  });
  it("the textblock's own sizing is untouched (control)", () => {
    expect(css).toMatch(/\.instance-textblock-block \.doc-editor-wrapper \.ProseMirror \{[^}]*padding: 4px 8px 4px 8px/);
  });
  it("keeps out of a table cell (a hovered cell grew 28 -> 46px)", () => {
    expect(css).toMatch(/> p:not\(\.doc-container:not\(\.doc-editor--mints\) \*\):not\(\.table-td \*\) \{/);
  });
});
