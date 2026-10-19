// A canvas card with no saved x/y sits in tidy columns near the world center — where the view
// opens — on BOTH canvases. The container canvas (the viewer's canvas arrangement) put every
// such card at (20,20): stacked on each other, off screen, so the canvas looked empty.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { canvasFallbackPosition } from "../helpers/canvasFallback";

describe("canvasFallbackPosition", () => {
  it("near the center, one row step apart, 8 per column", () => {
    expect(canvasFallbackPosition(0)).toEqual({ x: 1760, y: 1850 });
    expect(canvasFallbackPosition(1)).toEqual({ x: 1760, y: 1960 });
    expect(canvasFallbackPosition(8)).toEqual({ x: 2020, y: 1850 });
    expect(canvasFallbackPosition(-1)).toEqual({ x: 1760, y: 1850 });
  });
  it("both canvases use it; neither keeps a corner default", () => {
    const read = (f) => fs.readFileSync(path.resolve(__dirname, "..", f), "utf8");
    const mc = read("modules/ModuleContainer.jsx");
    expect(mc).toMatch(/canvasFallbackPosition\(/);
    expect(mc).not.toMatch(/meta\?\.x \?\? 20\b/);
    expect(read("modules/pages/PageCanvas.jsx")).toMatch(/canvasFallbackPosition\(/);
  });
});
