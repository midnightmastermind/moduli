// A textblock reads the same before and after it is clicked (user 2026-10-30: "change the font size to what it
// was before i edited" — the read-only stand-in was 14px, the editor the 17px label size). The stand-in and the
// live editor are set by ONE rule, at the doc text size.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const ruleWith = (sel) => { const i = css.indexOf(sel); if (i < 0) return ""; const start = css.lastIndexOf("}", i) + 1; return css.slice(start, css.indexOf("}", i)).replace(/\/\*[\s\S]*?\*\//g, ""); };

describe("textblock text: one size read-only and editing", () => {
  it("the live textblock body and its stand-in share one rule", () => {
    const rule = ruleWith(".instance-textblock-block .doc-editor-content.ProseMirror p,");
    expect(rule).toContain(".instance-textblock-block .textblock-card-placeholder");
    expect(rule).toContain(".textblock-card .textblock-card-placeholder");
    expect(rule).toMatch(/font-size: var\(--cascade-font-size, var\(--doc-text-px, 14px\)\);/);
    expect(rule).toMatch(/line-height: var\(--doc-text-line, 1\.35\);/);
  });
  it("the doc text size is 14px (control: the label size is not used for the body)", () => {
    expect(css).toMatch(/--doc-text-px: 14px;/);
    expect(ruleWith(".instance-textblock-block .doc-editor-content.ProseMirror p,")).not.toContain("--instance-label-px");
  });
});
