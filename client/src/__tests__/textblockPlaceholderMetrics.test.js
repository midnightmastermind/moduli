// A textblock's lazy stand-in must use the live editor's text size (user 2026-10-30: "i edit a textblock by
// clicking on it and the font size increases" — the stand-in was 14px, the editor the instance-label size).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const block = (sel) => { const i = css.indexOf(sel); return i < 0 ? "" : css.slice(i, css.indexOf("}", i)); };

describe("textblock stand-in metrics", () => {
  it("takes the same font-size expression as the live textblock editor", () => {
    const live = /\.instance-textblock-block \.doc-editor-content\.ProseMirror p,[\s\S]*?font-size: ([^;]+);/.exec(css)?.[1];
    expect(live).toBeTruthy();
    const stand = block(".instance-textblock-block .textblock-card-placeholder {");
    expect(stand).toContain(`font-size: ${live};`);
    expect(stand).toContain("line-height: 1.6;");
  });
  it("its lines take the live paragraph's spacing", () => {
    expect(block(".instance-textblock-block .textblock-card-placeholder > div {")).toContain("padding-block: calc(4px + 0.25em);");
  });
});
