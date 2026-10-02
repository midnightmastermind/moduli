// A wrap group whose last block is not a textblock shows two columns (2026-10-02).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
const src = fs.readFileSync(path.join(__dirname, "../docs/WrapGroupNode.jsx"), "utf8");
describe("WrapGroupNode non-text host", () => {
  it("columns mode when the last block is not textmapped", () => {
    expect(src).toMatch(/const columnsMode = node\.attrs\.wrap === false \|\| !hostIsText;/);
    expect(src).toMatch(/isTextmappedModule\(mod\)/);
  });
  it("an unloaded host counts as text (no flash of columns)", () => {
    expect(src).toMatch(/!occ \|\| !mod \? true :/);
  });
});
