// A BOARD PAGE OFFERS AN INSERT POSITION BETWEEN ITS OWN CONTAINERS.
//
// USER, 2026-09-23: *"theres no hover highlight quick add line for outside of
// those dimension containers (nothing in between creative and environmental)"*
// and *"the highlights for dropping places should be in between those
// containers too (and before and after), so i should be able to drop outside of
// those containers"*.
//
// `InsertGap` was rendered ONLY by `ModuleContainer`, between a container's own
// items. `PageBoard` — which lays out a page's top-level containers — rendered
// none, so on Routines there was no way to add, or aim at, a position between
// the nine dimension containers.
//
// STACK MODE ONLY, deliberately: the gap draws a horizontal rule between
// stacked children. In `grid` the children are cells with no "between", and in
// `flex-row` a horizontal rule across a column is meaningless — putting one
// there would advertise a position nothing can be dropped at.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "../modules/pages/PageBoard.jsx"), "utf8");
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("PageBoard renders insert gaps between its children", () => {
  it("imports and renders InsertGap", () => {
    expect(code).toMatch(/import InsertGap from/);
    expect((code.match(/<InsertGap/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("targets the PAGE occurrence and a CONTAINER, not an instance", () => {
    // A page's siblings are containers; the default targetRole would offer to
    // add a row where a row cannot go.
    expect(code).toMatch(/<InsertGap parentOccurrence=\{occurrence\}[^>]*targetRole="container"/);
  });

  it("puts one BEFORE each child and one AFTER the last", () => {
    expect(code).toMatch(/<InsertGap parentOccurrence=\{occurrence\} index=\{idx\}/);
    expect(code).toMatch(/index=\{visibleList\.length\}/);
  });

  it("is gated to STACK mode", () => {
    expect(code).toMatch(/const gapsEnabled = mode === "stack"/);
    expect(code).toMatch(/gapsEnabled \?/);
  });
});
