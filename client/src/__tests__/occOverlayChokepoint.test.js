// EVERY WRITE TO THE LOCAL OVERLAY GOES THROUGH ONE DOOR.
//
// The merge cache in helpers/occOverlay.js is keyed on a write COUNTER, which
// is only sound while there is exactly one writer. 2026-08-25 (9) chose a
// fingerprint scan over a counter for precisely this reason — there were ~20
// scattered `localOccsById[id] = …` sites and "a missed bump would serve
// operations stale occurrences, which is a correctness bug, not a perf one".
//
// That risk does not go away by being careful once; it goes away by making the
// raw form impossible to reintroduce quietly. 22 sites were rewritten to
// setLocalOcc / dropLocalOcc / resetLocalOccs, and this test is what keeps the
// twenty-third from being written by hand.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..", "state", "bindSocketToStore.js");
const src = readFileSync(SRC, "utf8");

// Strip comments first — the file DISCUSSES the old form at length, and a guard
// that fires on its own explanation is one somebody weakens (2026-08-20 paid
// for exactly that with `noDomainKnowledge`).
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");

const RAW_WRITE = /localOccsById\s*\[[^\]]+\]\s*=[^=]/g;
const RAW_DELETE = /delete\s+localOccsById\s*\[/g;

describe("localOccsById write chokepoint", () => {
  it("has no raw assignment outside the overlay helpers", () => {
    expect([...code.matchAll(RAW_WRITE)].map(m => m[0])).toEqual([]);
  });

  it("has no raw delete outside the overlay helpers", () => {
    expect([...code.matchAll(RAW_DELETE)].map(m => m[0])).toEqual([]);
  });

  it("still writes through the helpers — it did not just delete the writes", () => {
    // The control that makes the two zeros above mean something. An absence is
    // only evidence once the thing has been shown able to appear: if the writes
    // had simply been removed, both greps would also read zero and the app
    // would be broken.
    expect((code.match(/setLocalOcc\(/g) || []).length).toBeGreaterThan(15);
    expect((code.match(/dropLocalOcc\(/g) || []).length).toBeGreaterThan(2);
    expect((code.match(/resetLocalOccs\(/g) || []).length).toBeGreaterThan(0);
  });

  it("the patterns DO match a planted raw write (the grep works)", () => {
    // Without this, a typo in the regex reads as a permanently clean file.
    const planted = 'localOccsById[occ.id] = occ;\ndelete localOccsById[x];';
    expect([...planted.matchAll(RAW_WRITE)].length).toBe(1);
    expect([...planted.matchAll(RAW_DELETE)].length).toBe(1);
  });

  it("reads are NOT flagged — the guard is about writes only", () => {
    const reads = 'const a = localOccsById[id];\nif (localOccsById[id]) foo();\nx === localOccsById[id]';
    expect([...reads.matchAll(RAW_WRITE)].length).toBe(0);
    expect([...reads.matchAll(RAW_DELETE)].length).toBe(0);
  });

  it("both consumers of the merge go through the one helper", () => {
    // The drift this whole pass exists to close: 2026-08-25 (9) cached the
    // merge in _fireOperationsInner and left the seven rebuilds in
    // applyOperationEffect copying 21k keys apiece.
    expect(code).not.toMatch(/\{\s*\.\.\.\(state\.occurrencesById\s*\|\|\s*\{\}\),\s*\.\.\.localOccsById\s*\}/);
    expect((code.match(/mergedOccsOverlay\(/g) || []).length).toBeGreaterThan(7);
  });
});
