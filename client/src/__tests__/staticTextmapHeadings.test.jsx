// A heading in a textblock's read-only stand-in is a real <hN>, so the editor's heading rules (size, colour) apply
// before the first click (user, 2026-11-01: "my headers inside textblocks dont resolve … when i first load them").
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
vi.mock("../docs/pills/InstanceTextblockInlineNode.jsx", () => ({ default: () => null }));
import StaticTextmap from "../ui/StaticTextmap.jsx";
import fs from "node:fs";
import path from "node:path";

const h = (level, text) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });

describe("StaticTextmap headings", () => {
  it("draws each level as its own heading element", () => {
    const { container } = render(<StaticTextmap nodes={[h(1, "One"), h(2, "Two"), h(3, "Three")]} />);
    expect(container.querySelector("h1")?.textContent).toBe("One");
    expect(container.querySelector("h2")?.textContent).toBe("Two");
    expect(container.querySelector("h3")?.textContent).toBe("Three");
  });
  it("clamps a missing or odd level", () => {
    const { container } = render(<StaticTextmap nodes={[{ type: "heading", content: [{ type: "text", text: "x" }] }, h(9, "y")]} />);
    expect(container.querySelector("h1")?.textContent).toBe("x");
    expect(container.querySelector("h6")?.textContent).toBe("y");
  });
  it("the stand-in shares the editor's heading size rules", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../index.css"), "utf8");
    for (const t of ["h1", "h2", "h3"]) {
      expect(css).toMatch(new RegExp(`\\.doc-editor-content\\.ProseMirror ${t}, \\.textblock-card-placeholder ${t} \\{ font-size`));
    }
    expect(css).toMatch(/\.textblock-card-placeholder \{ --md-body/);
  });
});
