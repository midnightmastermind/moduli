// The tree's folder cover picker closes on Escape (UI sweep 2026-10-19). Mounting the tree
// needs the grid store; this pins the wiring inside FolderCoverEditor.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
const src = fs.readFileSync(path.resolve(__dirname, "../modules/ManifestTree.jsx"), "utf8");
const body = src.slice(src.indexOf("function FolderCoverEditor"), src.indexOf("function FolderCoverEditor") + 1500);
describe("folder cover picker", () => {
  it("closes on Escape", () => {
    expect(body).toMatch(/e\.key === "Escape"\) \{ e\.stopPropagation\(\); onClose\?\.\(\);/);
    expect(body).toMatch(/addEventListener\("keydown", onKey, true\)/);
  });
});
