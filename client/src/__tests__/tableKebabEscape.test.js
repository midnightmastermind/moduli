// The table's column menu closed only on an outside click; Escape did nothing (UI sweep 2026-10-19).
// ContainerTable needs the whole grid to mount, so this pins the wiring; it was watched on prod.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const src = readFileSync(resolve(process.cwd(), "src/modules/containers/ContainerTable.jsx"), "utf8");
describe("table column menu", () => {
  it("listens for Escape while open, and closes the menu (a sub-picker first)", () => {
    expect(src).toMatch(/e\.key !== "Escape"/);
    expect(src).toMatch(/document\.addEventListener\("keydown", onKey\)/);
    expect(src).toMatch(/document\.removeEventListener\("keydown", onKey\)/);
    expect(src).toMatch(/setKebabOpen\(null\);\s*\n\s*\}/);
  });
});
