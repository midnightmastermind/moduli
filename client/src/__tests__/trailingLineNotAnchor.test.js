// The doc's collapsed trailing line must not be a scroll anchor: revealing it on
// hover scrolled a bottom-scrolled panel and moved a handle out from under the click.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
const css = fs.readFileSync(path.join(__dirname, "../index.css"), "utf8");
describe("trailing click-to-type line", () => {
  it("is excluded from scroll anchoring", () => {
    const m = css.match(/\.doc-editor-content\.ProseMirror > p:last-child:not\(:first-child\):has\(> br\.ProseMirror-trailingBreak:only-child\) \{[^}]*\}/);
    expect(m).toBeTruthy();
    expect(m[0]).toMatch(/overflow-anchor:\s*none/);
    expect(m[0]).toMatch(/height:\s*0/);
  });
});
