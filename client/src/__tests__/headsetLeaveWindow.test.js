// @vitest-environment jsdom
// A touch drag that ends at a reader window's edge in the headset has LEFT the window (2026-10-25: dragging a row
// from one book to another dropped it at the source window's edge, and told the app the drop was taken).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { leftThroughEdge, LEAVE_EDGE_PX } from "../helpers/dragSystem.js";

describe("leftThroughEdge", () => {
  it("near any edge is leaving; the middle is not", () => {
    expect(leftThroughEdge(5, 300, 800, 600)).toBe(true);
    expect(leftThroughEdge(790, 300, 800, 600)).toBe(true);
    expect(leftThroughEdge(400, 3, 800, 600)).toBe(true);
    expect(leftThroughEdge(400, 590, 800, 600)).toBe(true);
    expect(leftThroughEdge(400, 300, 800, 600)).toBe(false);
    expect(leftThroughEdge(LEAVE_EDGE_PX + 1, 300, 800, 600)).toBe(false);
  });
  it("is only used inside the headset, and a doc drop counts as dropped", () => {
    const src = readFileSync(join(process.cwd(), "src/helpers/dragSystem.js"), "utf8");
    expect(src).toMatch(/const leftWindow = inHeadset\(\) && \(window\.__moduliOutside === true \|\| leftThroughEdge\(/);
    // A doc drop counts as dropped: touchDropStep answers dropped for the doc zone too, and dragEnd reports it.
    expect(src).toMatch(/return \{ dropped: true, docDropped: true \}/);
    expect(src).toMatch(/_nativeDrag\(\{ type: "dragEnd", dropped: _dropped \}\)/);
  });
});

describe("a drag carried in from another headset window", () => {
  it("runs the same hover and drop steps as a drag begun in this window", () => {
    const reader = readFileSync(join(process.cwd(), "src/ReaderApp.jsx"), "utf8");
    const drag = readFileSync(join(process.cwd(), "src/helpers/dragSystem.js"), "utf8");
    expect(reader).toMatch(/touchHoverStep\(\{ x, y, payload, cur, dragCtx: ctx\(\) \}\)/);
    expect(reader).toMatch(/touchDropStep\(\{ x, y, payload, cur, dragCtx: ctx\(\) \}\)/);
    // ...and the window's own drag uses them too (control: they are not a second copy).
    expect(drag).toMatch(/curTarget = touchHoverStep\(/);
    expect(drag).toMatch(/= touchDropStep\(\{/);
  });
  it("does not start dragging a page in the headset", () => {
    const drag = readFileSync(join(process.cwd(), "src/helpers/dragSystem.js"), "utf8");
    expect(drag).toMatch(/if \(inHeadset\(\) && type === DragType\.PAGE\) return;/);
  });
});
