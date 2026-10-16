import { describe, it, expect } from "vitest";
import { sectionTree, chunk, tailOf } from "../migrations/0408-complete-cut-off-notes.mjs";

const labels = (secs) => secs.map((s) => [s.label, s.level, labels(s.children)]);

describe("0408 sectionTree", () => {
  it("nests a run of numbered sections under the unnumbered heading before it", () => {
    const md = "# Mental Health\nintro\n# 1️⃣ Notice\na\n### Step 1\nb\n# 2️⃣ Clean\nc\n# If I Reduce\nd";
    expect(labels(sectionTree(md).sections)).toEqual([
      ["Mental Health", 2, [["1️⃣ Notice", 3, [["Step 1", 4, []]]], ["2️⃣ Clean", 3, []]]],
      ["If I Reduce", 2, []],
    ]);
  });
  it("keeps numbered sections top-level when nothing unnumbered comes first", () => {
    const md = "# 11️⃣ Clean\na\n# Final\nb";
    expect(labels(sectionTree(md).sections)).toEqual([["11️⃣ Clean", 2, []], ["Final", 2, []]]);
  });
  it("moves a demoted section's own sub-headings down with it", () => {
    const md = "# Frog\n## 1️⃣ Overview\n# 2️⃣ Layers\n## 🖥 1. Frontend\nx";
    expect(labels(sectionTree(md).sections)).toEqual([
      ["Frog", 2, [["1️⃣ Overview", 3, []], ["2️⃣ Layers", 3, [["🖥 1. Frontend", 4, []]]]]],
    ]);
  });
  it("treats the shallowest heading as level 2 (## notes)", () => {
    expect(labels(sectionTree("## A\nx\n## B\ny").sections)).toEqual([["A", 2, []], ["B", 2, []]]);
  });
});

describe("0408 tailOf", () => {
  it("adds a group heading where the note introduces a walkthrough without one", () => {
    const md = "# 8️⃣ Order\nx\nAbsolutely — we can categorize them\n# **1️⃣ Nigredo**\ny";
    const t = sectionTree(tailOf(md, "morenotes.md", 1));
    expect(labels(t.sections)).toEqual([
      ["8️⃣ Order", 2, []],
      ["The Unions Through the Four Stages", 2, [["1️⃣ Nigredo", 3, []]]],
    ]);
  });
});

describe("0408 chunk", () => {
  it("puts a table in a textblock of its own and pulls pictures out, unescaped", () => {
    const md = "![Image](https://a.test/x.jpg?a=1\\&b=2)\n\nlead text\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nafter\n\n---\n";
    const { textblocks, images } = chunk(md);
    expect(images).toEqual(["https://a.test/x.jpg?a=1&b=2"]);
    expect(textblocks.map((t) => t.table)).toEqual([false, true, false]);
    expect(textblocks[1].blocks[0].type).toBe("table");
  });
});
