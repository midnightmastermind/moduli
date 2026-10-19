// The canvas layers popout closed only on a click outside; Escape did nothing (UI sweep 2026-10-19).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const src = readFileSync(resolve(process.cwd(), "src/modules/CanvasContent.jsx"), "utf8");
describe("canvas layers popout", () => {
  it("closes on Escape while open", () => {
    expect(src).toMatch(/if \(!layersOpen\) return undefined;[\s\S]{0,200}e\.key === "Escape"\) setLayersOpen\(false\)/);
  });
});
