// @vitest-environment jsdom
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

// DELETING A FOLDER TAKES ITS OWN PAGE WITH IT (2026-10-01): the reparent loop
// moved the folder page up too, leaving a stray page named after the folder.
import { isFolderPageOf } from "../modules/ManifestTree.jsx";
describe("a folder's own page", () => {
  const mods = { fp: { role: "page", kind: "folder" }, bp: { role: "page", kind: "board" }, art: { role: "artifact", kind: "image" } };
  it("is recognised by its folder-kind page module", () => {
    expect(isFolderPageOf({ moduleId: "fp" }, mods)).toBe(true);
  });
  // The control: real content in the folder is NOT treated as its page.
  it("a board page or a file is not", () => {
    expect(isFolderPageOf({ moduleId: "bp" }, mods)).toBe(false);
    expect(isFolderPageOf({ moduleId: "art" }, mods)).toBe(false);
  });
  it("the delete handler deletes it instead of moving it up", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/modules/ManifestTree.jsx"), "utf8");
    const body = src.slice(src.indexOf("const handleDelete = useCallback"), src.indexOf("CommitHelpers.deleteFolder("));
    expect(body).toMatch(/isFolderPageOf\(occ, modulesById\)[\s\S]*deleteOccurrence/);
  });
});
