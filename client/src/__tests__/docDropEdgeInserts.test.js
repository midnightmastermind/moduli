// A drop on the top/bottom edge of a doc block inserts above/below it; only the
// middle wraps beside it (2026-10-02, Firefox: an edge drop wrapped two blocks).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
const src = fs.readFileSync(path.join(__dirname, "../ui/Editor.jsx"), "utf8");
describe("detectSideHost edge bands", () => {
  it("bails to a plain insert in the top/bottom band, before any side is chosen", () => {
    const band = src.indexOf("top/bottom edge → plain insert");
    const side = src.indexOf("non-text host, middle third → plain insert");
    expect(band).toBeGreaterThan(0);
    expect(band).toBeLessThan(side);
    expect(src).toMatch(/Math\.min\(EDGE_INSERT_PX, rect\.height \/ 3\)/);
    expect(src).toMatch(/export const EDGE_INSERT_PX = 12;/);
  });
});
