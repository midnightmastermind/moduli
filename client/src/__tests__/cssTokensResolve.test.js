// EVERY COLOUR TOKEN A STYLESHEET READS MUST BE DEFINED SOMEWHERE.
//
// User, 2026-08-22: *"the filter menu doesnt match the theme"*. It read
// `var(--panel-bg, #1f2125)` and `var(--panel-border, #374151)` — 26 uses across
// nine files — and **neither token was defined anywhere on the grid**. Every one
// fell through to its hardcoded dark literal, so the toolbar filter dropdown,
// its calendar and six other surfaces painted a dark slab on all six skins.
//
// WHY THE 2026-08-21 THEMING PASS MISSED IT. That pass converted 82 literals to
// tokens and verified there were no literals left. An inert token is invisible
// to that check: it LOOKS converted, and the dark fallback makes it look correct
// on a dark skin. The only thing that catches it is asking whether the token
// resolves — which is what this does.
//
// A fallback is not a defence, it is the disguise: `var(--x, #1f2125)` renders
// perfectly while `--x` is dead. And with NO fallback it is worse — the whole
// declaration is invalid and drops, which is how the doc placeholder lost its
// muted colour and read as real text.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { readdirSync } from "node:fs";

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every file under src/ with one of these extensions. No new dependency. */
function walk(dir, exts, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") walk(p, exts, out); }
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}
const cssFiles = () => walk(src, [".css"]);
const codeFiles = () => walk(src, [".js", ".jsx"]).filter((f) => !f.includes("__tests__"));

// Custom properties are also legally set INLINE from JS/JSX (per-element layout
// values like --child-w, --notch-h, the spread's transform origin) and PUBLISHED
// at runtime by the skin engine. Those are definitions too, so the scan reads
// them as such rather than pretending only CSS may define a token.
function definedNames() {
  const names = new Set();
  for (const f of cssFiles()) {
    for (const m of stripComments(readFileSync(f, "utf8")).matchAll(/--([a-zA-Z0-9-]+)\s*:/g)) names.add(m[1]);
  }
  for (const f of codeFiles()) {
    // READING a token in JSX is not DEFINING it. Stripping `var(--x, …)` first is
    // what makes this discriminate: without it, the nine files that merely READ
    // `var(--panel-bg, #1f2125)` registered `panel-bg` as defined and the whole
    // check passed against the very bug it was written for. Caught by A/B, which
    // is the only thing that can catch a vacuous assertion.
    const code = readFileSync(f, "utf8").replace(/var\(\s*--[a-zA-Z0-9-]+/g, "");
    for (const m of code.matchAll(/--([a-zA-Z0-9-]+)/g)) names.add(m[1]);
  }
  return names;
}

describe("CSS custom properties resolve", () => {
  it("every token a stylesheet reads is defined somewhere", () => {
    const defined = definedNames();
    const unresolved = [];
    for (const f of cssFiles()) {
      const rel = path.relative(src, f);
      for (const m of stripComments(readFileSync(f, "utf8")).matchAll(/var\(\s*--([a-zA-Z0-9-]+)/g)) {
        if (!defined.has(m[1])) unresolved.push(`--${m[1]} (read in ${rel})`);
      }
    }
    expect([...new Set(unresolved)]).toEqual([]);
  });

  // The two that started this, pinned by name. The scan above would catch them
  // again, but naming them says WHICH regression this file is really about.
  it("--panel-bg and --panel-border are defined, not merely fallen back on", () => {
    const defined = definedNames();
    expect(defined.has("panel-bg")).toBe(true);
    expect(defined.has("panel-border")).toBe(true);
  });
});
