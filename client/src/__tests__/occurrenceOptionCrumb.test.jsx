// THE CRUMB HAS TO REACH THE SCREEN, and crumbing the label string did not.
//
// `optionsResolver` suffixes a colliding option's label with its ancestor
// chain, and every unit test of that passed — but the occurrence picker renders
// through `OccurrenceOption`, which re-resolves the row and does:
//
//     const label = card?.label || (... fallbackLabel || occId);
//
// `card.label` comes from the live occurrence and rightly WINS, so the crumbed
// label was never shown. Caught 2026-09-23 by opening the dropdown rather than
// trusting the resolver tests — the "my fix was inert" class this log records
// repeatedly.
//
// The fix keeps the live label as the label and renders the chain as its own
// muted line, so both facts are on screen and neither overwrites the other.
import { describe, it, expect } from "vitest";

// NO BEHAVIOURAL TEST HERE, deliberately. Two were written and both were
// VACUOUS: one asserted a truthy local, and the other short-circuited because
// `OccurrenceOption` is module-private, so it passed without rendering
// anything. Exporting a component purely to test it, or driving a portalled
// Radix popover in jsdom, buys less than the source guards below plus the one
// thing that actually settles it — opening the dropdown in a real browser,
// which is how the inert version was caught in the first place.

describe("the wiring, pinned at the source", () => {
  const src = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../ui/Field.jsx"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("OccurrenceOption accepts a crumb", () => {
    expect(code).toMatch(/function OccurrenceOption\([^)]*crumb = null[^)]*\)/);
  });

  it("and renders it", () => {
    expect(code).toMatch(/\{crumb && \(/);
  });

  it("the occurrence renderer passes the option's _crumb through", () => {
    // Without this the chain is computed, attached, and thrown away.
    expect(code).toMatch(/<OccurrenceOption[^>]*crumb=\{o\._crumb \|\| null\}/);
  });

  it("the live label still wins for the label itself (the control)", () => {
    // The crumb is an ADDITION, not a replacement: a renamed row must still
    // show its new name.
    expect(code).toMatch(/const label = card\?\.label \|\|/);
  });
});
