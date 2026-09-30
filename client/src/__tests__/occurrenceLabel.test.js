// A ROW IS NAMED BY ITS PLACEMENT, NOT BY ITS TYPE.
//
// User, 2026-09-29: *"for the label of each movie it doesnt have the movie name,
// it just says Movie"*. On poms, 13 shared type-modules cover 12,265 rows —
// 993 movies point at ONE module labelled "Movie", 5,484 songs at "Song" — so a
// renderer reading the module first shows the SAME name for every row of a kind.
//
// THE WALKER IS THE POINT. Five surfaces had this rule and three had it
// backwards; the failure mode is the next one someone writes.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { occurrenceDisplayLabel } from "../helpers/occurrenceLabel.js";

describe("occurrenceDisplayLabel", () => {
  it("prefers the placement's own title", () => {
    expect(occurrenceDisplayLabel({ label: "John Wick" }, { label: "Movie" })).toBe("John Wick");
  });

  it("falls back to the type when a placement has no name — a container, a page", () => {
    expect(occurrenceDisplayLabel({ label: "" }, { label: "Ingredients" })).toBe("Ingredients");
    expect(occurrenceDisplayLabel(null, { label: "Ingredients" })).toBe("Ingredients");
  });

  it("treats a whitespace-only label as no label", () => {
    expect(occurrenceDisplayLabel({ label: "   " }, { label: "Movie" })).toBe("Movie");
  });

  it("uses the caller's fallback when neither has a name", () => {
    expect(occurrenceDisplayLabel({}, {}, "this item")).toBe("this item");
    expect(occurrenceDisplayLabel({}, {})).toBe("");
  });

  // A non-string label (an operation writing a number, a null) must not throw
  // or stringify into the UI as "[object Object]".
  it("ignores a label that is not a string", () => {
    expect(occurrenceDisplayLabel({ label: { x: 1 } }, { label: "Movie" })).toBe("Movie");
    expect(occurrenceDisplayLabel({ label: 7 }, { label: "Movie" })).toBe("Movie");
  });
});

// ── THE WALKER ──────────────────────────────────────────────────────────────
const SRC = path.join(process.cwd(), "src");
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "__tests__") walk(p); }
    else if (/\.(jsx?|tsx?)$/.test(e.name)) files.push(p);
  }
})(SRC);

// `module.label || occurrence.label` in either spelling, optional chaining or not.
const MODULE_FIRST = /\b(?:module|mod|instance|targetMod)\s*\??\.\s*label\s*\|\|\s*(?:occurrence|occ|item)\s*\??\.\s*label/;

describe("no renderer names a row by its TYPE first", () => {
  it("finds no module-first label fallback anywhere in the client", () => {
    const offenders = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      // Strip comments, or this file's own explanation of the bug trips it.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      if (MODULE_FIRST.test(code)) offenders.push(path.relative(SRC, f));
    }
    expect(offenders).toEqual([]);
  });

  // THE CONTROL. "No offenders" is equally satisfied by a detector that matches
  // nothing, and by a walker that read no files.
  it("the detector still recognises the shape, and the walk saw the real tree", () => {
    expect(MODULE_FIRST.test('const x = module?.label || occurrence?.label || "";')).toBe(true);
    expect(MODULE_FIRST.test("return mod?.label || occ?.label;")).toBe(true);
    // And the CORRECT order is not flagged.
    expect(MODULE_FIRST.test('occurrence?.label || module?.label || ""')).toBe(false);
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.endsWith("ArtifactCard.jsx"))).toBe(true);
  });
});

// ── THE CARD'S OWN GUARD ────────────────────────────────────────────────────
//
// The walker above cannot see ArtifactCard's shape: it read a `label` PROP —
// which every call site fills with `mod.label` — and never consulted the
// occurrence at all, so the module-first order is not written anywhere in the
// file. This is what discriminates that fix.
describe("ArtifactCard names a row from its placement", () => {
  const src = fs.readFileSync(path.join(SRC, "modules/ArtifactCard.jsx"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("derives every displayed name through the shared rule", () => {
    const names = code.match(/const fileName = [^\n]*/g) || [];
    expect(names.length).toBeGreaterThanOrEqual(2);   // thumb-info + full-bleed
    for (const line of names) expect(line).toMatch(/occurrenceDisplayLabel\(occurrence, module\)/);
  });

  it("keeps meta.originalName ahead of it — that is an upload's own file name", () => {
    for (const line of code.match(/const fileName = [^\n]*/g) || []) {
      expect(line.indexOf("originalName")).toBeLessThan(line.indexOf("occurrenceDisplayLabel"));
    }
  });

  // The control: this is reading the real component, not an empty string.
  it("is reading the file that renders the name", () => {
    expect(src).toContain("artifact-thumb-info-name");
    expect(src.length).toBeGreaterThan(5000);
  });
});

