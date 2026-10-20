// A container draws every child CONTAINER it lists. The `meta.allowChildContainers` gate hid real data three
// times (kanban columns, an imported article, a template applied with Copy — 2026-10-20). ModuleContainer needs
// the whole grid to mount, so this pins the wiring.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const src = readFileSync(resolve(process.cwd(), "src/modules/ModuleContainer.jsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("child containers", () => {
  it("are looked up in the full module map, not the leaf-only one", () => {
    expect(src).toMatch(/const childModuleLookup = modulesById;/);
  });
  it("mount as a Container whatever the parent's flag says", () => {
    expect(src).toMatch(/if \(role === "container"\) \{/);
    expect(src).not.toMatch(/allowChildContainers/);
  });
});
