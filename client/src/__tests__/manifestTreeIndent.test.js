// ONE STEP PER LEVEL (user, 2026-10-01): every tree node renders INSIDE its
// parent's wrapper, so `depth * 8` on top of the parent's indent compounded —
// 8, 24, 48, 80px — and deep Codex rows ran off the panel.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { treeIndent, TREE_INDENT } from "../modules/ManifestTree.jsx";

describe("manifest tree indentation", () => {
  it("adds the same step at every depth", () => {
    expect(treeIndent(0)).toBe(0);
    for (const d of [1, 2, 5, 9]) expect(treeIndent(d)).toBe(TREE_INDENT);
  });
  // The rendered total is the sum of each ancestor's step, so it grows linearly.
  it("a node at depth d sits d steps in, not a triangular number", () => {
    const total = (d) => Array.from({ length: d + 1 }, (_, i) => treeIndent(i)).reduce((a, b) => a + b, 0);
    expect(total(6)).toBe(6 * TREE_INDENT);
  });
  it("no row multiplies its depth into a margin any more", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/modules/ManifestTree.jsx"), "utf8").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/marginLeft:\s*depth\s*\*/);
    expect(src).toMatch(/marginLeft:\s*treeIndent\(depth\)/);   // control: the rule is applied
  });
});
