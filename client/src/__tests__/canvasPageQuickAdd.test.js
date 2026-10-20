// A canvas or table page holds cards / rows, so its "+" offers the container palette (Item, Textblock, file…)
// and creates through createChildInContainer — it offered only Board/Doc/Canvas/Table (user 2026-10-19:
// "make sure it can quickly add occurrences to them … utilize the quick add menu"). Mounting ModulePage needs the
// whole grid store, so this pins the wiring; the add was watched on prod.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const src = readFileSync(resolve(process.cwd(), "src/modules/ModulePage.jsx"), "utf8");

describe("canvas / table page quick add", () => {
  it("a canvas, table or board page is a leaf host (doc pages are not)", () => {
    expect(src).toMatch(/const leafHostPage = kind === "canvas" \|\| kind === "table" \|\| kind === "board";/);
  });
  it("its + uses the instance palette and the container router", () => {
    expect(src).toMatch(/\{leafHostPage \? \(\s*<QuickAddMenu\s*targetRole="instance"\s*onSelect=\{handleQuickAddExisting\}\s*onCreateNew=\{handleQuickCreateLeaf\}/);
    expect(src).toMatch(/CommitHelpers\.createChildInContainer\(\{[\s\S]*?containerOccurrence: occurrence, containerModule: pageModule,/);
  });
  it("other pages keep the container palette", () => {
    expect(src).toMatch(/targetRole="container"\s*onSelect=\{handleQuickAddContainer\}/);
  });
  it("the hooks are declared before the page's early return", () => {
    expect(src.indexOf("const handleQuickCreateLeaf")).toBeLessThan(src.indexOf("if (!pageModule || !occurrence) return null;"));
  });
});
