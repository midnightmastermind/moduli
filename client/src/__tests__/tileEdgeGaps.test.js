// A tracker's 4th tile, wrapped onto the next line, had no add-here gap on its LEFT: the gap was its own flex item and
// stayed at the end of the line above (user, 2026-11-15). In a tile layout each tile draws its own left/right gaps.
// Wiring guards (mounting a container needs the whole grid store), each with a control.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8");
const container = read("modules/ModuleContainer.jsx");
const instance = read("modules/ModuleInstance.jsx");
const css = read("index.css");

describe("tile edge gaps", () => {
  it("a tile layout hands each tile its index and draws no separate gap for it", () => {
    expect(container).toMatch(/const tileEdgeGaps = \/container-items--\(wrap\|row\)\//);
    expect(container).toMatch(/edgeGapIndex=\{tileEdgeGaps && containerOccurrence \? idx : null\}/);
    expect(container).toMatch(/containerOccurrence && !ownsEdges && \(/);
  });
  it("control: a stack list still draws its gap elements", () => {
    expect(container).toMatch(/<InsertGap parentOccurrence=\{containerOccurrence\} index=\{idx\}/);
  });
  it("the tile draws a left gap at its index and a right one after it", () => {
    expect(instance).toMatch(/index=\{edgeGapIndex\}[^>]*edge="left"/);
    expect(instance).toMatch(/index=\{edgeGapIndex \+ 1\}[^>]*edge="right"/);
  });
  it("the gaps sit in the gutter and the wrap tile does not clip them", () => {
    expect(css).toMatch(/\.instance-wrap > \.insert-gap--edge-left \{ left: calc\(-1 \* var\(--child-gap, 8px\) \/ 2\); \}/);
    expect(css).toMatch(/overflow: clip;\s*overflow-clip-margin: var\(--child-gap, 8px\);/);
  });
});

// "have the buttons go right next to the header labels" — measured on prod: the embedded label was flex: 1, so the
// button after it landed at the far right. The label is its text's width now.
describe("header buttons sit beside the label", () => {
  it("the embedded header's label does not grow", () => {
    expect(container).not.toMatch(/color: embeddedAccent, lineHeight: 1\.2, flex: 1, minWidth: 0/);
    expect(container.match(/color: embeddedAccent, lineHeight: 1\.2, flex: "0 1 auto", minWidth: 0/g)).toHaveLength(2);
  });
});
