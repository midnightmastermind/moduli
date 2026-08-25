// Every floating menu surface reads the theme, and this test is the thing that
// keeps it that way.
//
// User, 2026-08-21: *"also making sure all the dropdowns and menus all match the
// theme"*. Measured before the sweep: **82 literal colours across 20 floating
// surfaces** — a black drop shadow under a cream panel on all three light skins,
// a tailwind-green success toast in front of Stardew's brown, and `color:"white"`
// on an accent fill that is MUSTARD on vintage-dark.
//
// THE TEST IS A GREP, DELIBERATELY. The rule is "no literal colour in a floating
// surface", and a rendered assertion can only check the surfaces somebody
// remembered to mount — which is exactly how the last three of these got in
// (2026-08-19 (9): "I fixed the call sites I had MEASURED instead of grepping the
// TOKEN"). Detection is STRUCTURAL: a file that portals to the body and positions
// itself fixed, plus the shared menu shells — never a list of filenames, or the
// next menu added is exempt by default.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LITERAL = /rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*[\d.]+\s*)?\)|#[0-9a-fA-F]{3,8}\b|["']white["']/g;

// Deliberate exceptions, each with a reason. A colour a USER assigns is not a
// theme surface — re-hueing it per skin would change something they picked.
const ALLOWED = [
  { file: "modules/ManifestTree.jsx", why: "the folder COVER palette — eight colours the user assigns to a folder" },
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "__tests__") walk(p, out); }
    else if (e.name.endsWith(".jsx")) out.push(p);
  }
  return out;
}

function menuSurfaces() {
  const shells = new Set(["MenuSurface.jsx", "HeaderDropdown.jsx", "ContextMenu.jsx", "QuickAddMenu.jsx"]);
  return walk(SRC).filter((p) => {
    const t = fs.readFileSync(p, "utf8");
    return (t.includes("createPortal") && t.includes('position: "fixed"'))
      || /from "\.\/MenuSurface|from "\.\.\/ui\/MenuSurface/.test(t)
      || shells.has(path.basename(p));
  });
}

describe("floating menus carry no literal colours", () => {
  const files = menuSurfaces();

  it("finds the surfaces at all — the control", () => {
    // A grep that matches nothing passes vacuously. This repo has shipped that
    // exact false negative more than once.
    expect(files.length).toBeGreaterThanOrEqual(15);
    const names = files.map((f) => path.basename(f));
    for (const n of ["ContextMenu.jsx", "QuickAddMenu.jsx", "MenuSurface.jsx", "AlarmDropdown.jsx"]) {
      expect(names).toContain(n);
    }
  });

  it("every one of them uses tokens", () => {
    const offenders = [];
    for (const p of files) {
      const rel = path.relative(SRC, p).replace(/\\/g, "/");
      if (ALLOWED.some((a) => a.file === rel)) continue;
      const t = fs.readFileSync(p, "utf8");
      for (const line of t.split("\n")) {
        // A literal inside a `var(--token, fallback)` chain is the fallback,
        // which is what a fallback is for.
        const stripped = line.replace(/var\(--[^)]*\)/g, "");
        const hits = stripped.match(LITERAL);
        if (hits) offenders.push(`${rel}: ${hits.join(", ")}  ::  ${line.trim().slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // A FALLBACK TO A TOKEN NOBODY DEFINES IS NOT A FALLBACK — IT IS THE VALUE.
  //
  // The check above strips `var(--token, literal)` on the reasoning that a
  // fallback is what a fallback is for. That reasoning holds only while the
  // token EXISTS. `HeaderDropdown` and `ToolbarFilterDropdown` both read
  // `var(--panel-fg, <near-white>)`, and `--panel-fg` was defined nowhere —
  // not in index.css, not in the skin registry — so every menu painted that
  // near-white unconditionally: right on a dark theme by accident, invisible
  // on all three light skins. It passed this suite for as long as it shipped.
  //
  // The inert-token class, reached from the FALLBACK side.
  it("no floating surface falls back on a token nothing defines", () => {
    const defined = new Set();
    const cssText = fs.readFileSync(path.join(SRC, "index.css"), "utf8");
    for (const m of cssText.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) defined.add(m[1]);
    // Tokens published from JS at runtime (applySkin and friends) count too.
    for (const f of walk(SRC).concat(
      fs.readdirSync(path.join(SRC, "helpers")).map((n) => path.join(SRC, "helpers", n)),
    )) {
      if (!/\.(jsx?|css)$/.test(f)) continue;
      const t = fs.readFileSync(f, "utf8");
      for (const m of t.matchAll(/setProperty\(\s*["'`](--[a-zA-Z0-9-]+)/g)) defined.add(m[1]);
      for (const m of t.matchAll(/["'`](--[a-zA-Z0-9-]+)["'`]\s*:/g)) defined.add(m[1]);
    }
    // The control: a token this app certainly defines must be seen as defined.
    expect(defined.has("--text-primary")).toBe(true);
    expect(defined.size).toBeGreaterThan(30);

    const offenders = [];
    for (const p2 of files) {
      const rel = path.relative(SRC, p2).replace(/\\/g, "/");
      const t = fs.readFileSync(p2, "utf8");
      for (const m of t.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*,([^)]*)\)/g)) {
        if (!m[2].trim()) continue;          // no fallback, nothing to hide behind
        if (defined.has(m[1])) continue;     // a real token with a real fallback
        offenders.push(`${rel}: var(${m[1]}, …) — ${m[1]} is defined nowhere`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no floating surface hardcodes its own drop shadow", () => {
    // The shadow scale is the one that was worst: TEN arbitrary geometries and a
    // black smudge on every light skin.
    const bad = [];
    for (const p of walk(SRC)) {
      const t = fs.readFileSync(p, "utf8");
      const m = t.match(/boxShadow:\s*"0 -?\d+px \d+px rgba\(0/g);
      if (m) bad.push(`${path.relative(SRC, p)}: ${m.length}`);
    }
    expect(bad).toEqual([]);
  });
});
