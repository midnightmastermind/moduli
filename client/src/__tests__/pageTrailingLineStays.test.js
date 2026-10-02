// A doc PAGE's own trailing line is never collapsed: it ends the page's
// scroller, so collapsing it on hover changed the scroll height and moved
// content under the pointer at the bottom of a page (2026-10-02).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
const css = fs.readFileSync(path.join(__dirname, "../index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const LINE = "p:last-child:not(:first-child):has(> br.ProseMirror-trailingBreak:only-child)";
const PAGE = `.page-scroll > .doc-container > .doc-editor > .doc-editor-wrapper > * > .doc-editor-content.ProseMirror > ${LINE}`;
const ruleFor = (selector) => {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(",").map((s) => s.trim()).includes(selector)) return m[2];
  }
  return null;
};
describe("doc trailing click-to-type line", () => {
  it("is still collapsed inside blocks (the control)", () => {
    const body = ruleFor(`.doc-editor-content.ProseMirror > ${LINE}`);
    expect(body).toMatch(/height:\s*0/);
  });
  it("is always revealed for the page's own editor", () => {
    const body = ruleFor(PAGE);
    expect(body).toBeTruthy();
    expect(body).toMatch(/height:\s*auto/);
  });
  it("the page selector matches PageDoc's scroller class", () => {
    const src = fs.readFileSync(path.join(__dirname, "../modules/pages/PageDoc.jsx"), "utf8");
    expect(src).toMatch(/className="page-scroll"/);
  });
});
