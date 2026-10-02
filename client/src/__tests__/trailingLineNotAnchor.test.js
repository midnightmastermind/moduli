// No editor's last paragraph may be a scroll anchor: revealing the collapsed
// trailing line on hover scrolled a bottom-scrolled panel and moved a handle
// out from under the click (2026-10-02).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
const css = fs.readFileSync(path.join(__dirname, "../index.css"), "utf8");
describe("editor last paragraphs", () => {
  it("are excluded from scroll anchoring, for every editor", () => {
    expect(css).toMatch(/\n\.doc-editor-content\.ProseMirror > p:last-child \{\s*overflow-anchor:\s*none;\s*\}/);
  });
});
