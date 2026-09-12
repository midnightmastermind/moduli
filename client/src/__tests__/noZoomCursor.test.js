// User, 2026-09-11: "i dont want zoom in cursors on the app so change those to
// pointer cursors (the ones that go on links)". Asked once, never done, and asked
// again 2026-09-12 — so it is a guard now rather than a memory.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "__tests__" || e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(jsx?|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

// A CURSOR declaration only — `zoom-in-95` animation class names are not cursors.
const ZOOM_CURSOR = /cursor\s*:\s*["']?zoom-(in|out)/;

describe("no zoom cursors", () => {
  it("no source file sets a zoom-in or zoom-out cursor", () => {
    const hits = walk(SRC).filter((f) => ZOOM_CURSOR.test(fs.readFileSync(f, "utf8")));
    expect(hits.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  // THE CONTROL: the pattern must be able to match, or an empty result is a
  // claim about the regex.
  it("the pattern catches both the CSS and the inline-style spelling", () => {
    expect(ZOOM_CURSOR.test("cursor: zoom-in;")).toBe(true);
    expect(ZOOM_CURSOR.test('style={{ cursor: "zoom-in" }}')).toBe(true);
    expect(ZOOM_CURSOR.test('"animate-in fade-in-0 zoom-in-95"')).toBe(false);
  });

  // The open-as-page button shipped at opacity 0 and was never seen on a tablet.
  it("the open-as-page button is visible at rest", () => {
    const css = fs.readFileSync(path.join(SRC, "index.css"), "utf8");
    const rule = css.match(/\.artifact-thumb-page-hint\s*\{([^}]*)\}/);
    expect(rule).toBeTruthy();
    const opacity = rule[1].match(/opacity\s*:\s*([\d.]+)/);
    expect(opacity && Number(opacity[1])).toBeGreaterThan(0.5);
  });
});
