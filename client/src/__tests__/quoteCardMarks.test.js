import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// THE QUOTE CARD'S TWO MARKS AND THE DRAG HANDLE THAT SAT ON TOP OF ONE.
//
// User, 2026-09-17: *"the quote occurance doesnt have the end quote icon and the
// front one (including the drag handle), should be moved to the right more."*
//
// Measured on prod before anything changed (test grid 2, the Watts article,
// reading each card's OWN `.instance-row` — the first probe read
// `.instance-wrap`, which climbs PAST the row into the embedding host and
// reported another row's handle):
//
//     card          left 81, width 753
//     handle group  absolute at the ROW's left edge -> 76..98  = 17px INTO the card
//     opening mark  card+15 .. card+33                        = 2px UNDER the handle
//     closing mark  absent
//     control: an IMAGE card's handle sits at card+5, clear of its content
//
// Both halves are pinned here because both can regress silently: a CSS-only
// change shows nothing in a build, and no test mounts ArtifactCard.
const src = (...p) => readFileSync(join(__dirname, "..", ...p), "utf8");
const css = src("index.css").replace(/\/\*[\s\S]*?\*\//g, "");
const jsx = src("modules", "ArtifactCard.jsx");

describe("quote card marks", () => {
  it("renders BOTH an opening and a closing mark", () => {
    expect(jsx).toMatch(/artifact-quote-mark--open/);
    expect(jsx).toMatch(/artifact-quote-mark--close/);
    expect(jsx).toMatch(/&ldquo;/);
    expect(jsx).toMatch(/&rdquo;/);
  });

  // THE CLOSING MARK IS INSIDE THE BLOCKQUOTE, and that placement is the fix.
  // Absolutely positioned at the card's bottom-right it would share that corner
  // with `.artifact-quote-attr`, which is `text-align: right` — so every quote
  // carrying an attribution would print the two on top of each other.
  it("puts the closing mark inside the quote text, not the card's corner", () => {
    const block = jsx.slice(jsx.indexOf("<blockquote"), jsx.indexOf("</blockquote>"));
    expect(block).toMatch(/artifact-quote-mark--close/);
    expect(css).not.toMatch(/\.artifact-quote-mark--close\s*\{[^}]*position:\s*absolute/);
  });

  it("the opening mark clears the drag handle", () => {
    const open = /\.artifact-quote-mark--open\s*\{([^}]*)\}/.exec(css)?.[1] || "";
    const left = Number(/left:\s*(\d+)px/.exec(open)?.[1]);
    // The handle is 22px wide and now starts 12px right of the row edge, i.e.
    // ~card+7, ending ~card+29. Anything under that is back under the handle.
    expect(left).toBeGreaterThanOrEqual(30);
  });

  it("the text column starts right of BOTH the handle and the opening mark", () => {
    const pad = /\.artifact-card--quote\s*\{([^}]*)\}/.exec(css)?.[1] || "";
    const padLeft = Number(/padding:[^;]*\s(\d+)px;/.exec(pad)?.[1]);
    expect(padLeft).toBeGreaterThanOrEqual(50);
  });
});

describe("quote card handle scope", () => {
  // SCOPED BY THE DIRECT CHAIN. These cards are embedded in an ARTICLE, so a
  // descendant selector would match every ancestor row whose doc merely
  // CONTAINS a quote card and shove that row's own handle sideways — the exact
  // leak the stacked wrap-group rule cost a day for on the same date.
  it("moves only the quote row's own handle", () => {
    const rule = /\.instance-content:has\(([^)]*)\)\s*>\s*\.instance-handle-group/.exec(css);
    expect(rule).toBeTruthy();
    expect(rule[1]).toContain("> .instance-body > .artifact-card--quote");
  });

  it("uses no descendant form that could reach an outer row", () => {
    expect(css).not.toMatch(/\.instance-content:has\(\s*\.artifact-card--quote\s*\)/);
    expect(css).not.toMatch(/\.instance-row:has\([^)]*artifact-card--quote[^)]*\)\s+\.instance-handle-group/);
  });
});
