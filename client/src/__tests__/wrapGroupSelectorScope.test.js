import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A WRAP GROUP'S LAYOUT RULES MUST NOT REACH A WRAP GROUP NESTED INSIDE IT.
//
// 2026-09-17: dragging a whole imported section beside an empty container made
// an OUTER group that auto-stacked — and its stacked rule
//   .wrap-group--auto-stacked .wrap-group-content > * > :not(:last-child)
//     { float: none !important; width: 100% }
// is a DESCENDANT selector, so it matched every image+prose group inside the
// section too. Their images could no longer float, each one measured "no room",
// stacked, measured "room", wrapped, and looped every few frames; the page
// jumped up and down. Measured on the reproduced page: group height alternating
// 7416 <-> 7435px; with the selectors scoped to the group's own content, 1 state.
const css = readFileSync(join(__dirname, "..", "index.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

describe("wrap-group CSS scope", () => {
  it("every mode rule targets the group's OWN content (child combinator)", () => {
    const leaks = css.match(/\.wrap-group(?:--[\w-]+)?(?:\.wrap-group--[\w-]+)*\s+\.wrap-group-content/g) || [];
    expect(leaks).toEqual([]);
  });

  // Control: the scoped form is actually present, so an empty leak list is not
  // just the regex matching nothing.
  it("the scoped rules exist", () => {
    const scoped = css.match(/\.wrap-group--(?:on|auto-stacked|off)[\w.-]*\s*>\s*\.wrap-group-content/g) || [];
    expect(scoped.length).toBeGreaterThan(20);
  });
});
