// UI sweep 2026-10-19, canvas deep test: Fill painted an opaque wash over the drawing layer, which
// sits ABOVE the cards while a drawing tool is active, so every card and earlier stroke vanished;
// and "New textblock" never put the cursor in the block it made.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { canvasBackgroundFill } from "../modules/CanvasContent.jsx";

const src = fs.readFileSync(path.resolve(__dirname, "../modules/CanvasContent.jsx"), "utf8");

describe("canvas fill is the background", () => {
  it("the last fill wins; no fill, no background", () => {
    expect(canvasBackgroundFill([{ tool: "pen" }, { tool: "fill", color: "#111" }, { tool: "rect" }, { tool: "fill", color: "#222" }])).toBe("#222");
    expect(canvasBackgroundFill([{ tool: "pen" }])).toBe(null);
  });
  it("is not painted on the drawing layer, and colours the world", () => {
    const body = src.slice(src.indexOf("function renderStrokes"), src.indexOf("function renderStrokes") + 2500);
    expect(body).toMatch(/if \(s\.tool === "fill"\) continue;/);
    expect(body).not.toMatch(/fillRect\(0, 0, ctx\.canvas\.width/);
    expect(src).toMatch(/backgroundColor: backgroundFill \|\| undefined/);
  });
});

describe("New textblock", () => {
  it("claims focus for the block it creates", () => {
    const at = src.indexOf("const newTextblockButton");
    const body = src.slice(at, src.indexOf('title="New textblock at canvas center"', at));
    expect(body).toMatch(/requestTextblockFocus\(res\.occurrenceId\)/);
  });
});
