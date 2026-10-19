/**
 * containerContextMenu.test.js — the container's right-click menu (UI sweep 2026-10-19).
 * Mounting ModuleContainer needs the whole grid store, so these pin the source.
 *  - "Copy container" made a bare module with NO occurrence (nothing appeared, an orphan
 *    module). It places a copy after this one, as a copy-drag does.
 *  - The add tiles are named as the header "+" names them from a container.
 *  - The remove item says "Remove container" — a container is not on the grid.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "../modules/ModuleContainer.jsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const copyItem = src.slice(src.indexOf('label: "Copy container"'), src.indexOf('label: "Copy container"') + 900);

describe("container context menu", () => {
  it("still has a Copy container item (control)", () => {
    expect(src).toContain('label: "Copy container"');
  });
  it("copies by placing an occurrence, never a bare module", () => {
    expect(copyItem).toMatch(/copyContainerToList\(/);
    expect(copyItem).not.toMatch(/createModule\(/);
  });
  it("names the add tiles as the + menu does", () => {
    expect(src).toMatch(/tileMeta\(kind, "instance"\)/);
  });
  it("says Remove container, not Remove from grid", () => {
    expect(src).toContain('label: "Remove container"');
    expect(src).not.toContain('"Remove from grid"');
  });
});
