// 0241 — removing a category means removing its SURFACES, not just its rows.
import { describe, it, expect } from "vitest";
import { stripCounterSteps, isDocumentary, KEY_PREFIX, TAG, FIELD_NAME } from "../migrations/0241-drop-the-documentaries.mjs";
import { COUNTS, varFor } from "../migrations/0239-media-owned-tracker.mjs";

const uid = () => Math.random().toString(36).slice(2, 8);
const A = (config) => ({ id: uid(), type: "action", config });
const pipeline = () => ({ steps: [
  A({ type: "INIT_VAR", name: "$tile", expr: "$allItemsById.tile1" }),
  ...COUNTS.map(([n]) => A({ type: "INIT_VAR", name: varFor(n), value: 0 })),
  { id: uid(), type: "loop", overExpr: "$allItems", as: "$m", body: [
    { id: uid(), type: "if", condition: { operator: "AND", rules: [] },
      then: COUNTS.map(([n]) => ({ id: uid(), type: "if",
        condition: { operator: "AND", rules: [] },
        then: [A({ type: "INCREMENT_VAR", name: varFor(n), by: 1 })], else: [] })),
      else: [] },
  ] },
  ...COUNTS.map(([n]) => A({ type: "UPDATE", path: `$tile.fields.fid-${varFor(n)}.value`, value: varFor(n) })),
]});

const DOC = COUNTS.find(([, t]) => t === TAG);
const DOC_VAR = varFor(DOC[0]);

describe("stripCounterSteps — the op stops counting a category that no longer exists", () => {
  it("removes exactly this counter's three steps: INIT_VAR, the IF, and the UPDATE", () => {
    const p = pipeline();
    const removed = stripCounterSteps(p, { varName: DOC_VAR, fieldId: `fid-${DOC_VAR}` });
    expect(removed).toBe(3);
  });

  it("leaves EVERY other counter intact — the discriminating case", () => {
    // A prune that took the whole IF body, or matched on a prefix, would take
    // the six other counts with it and the tile would silently read zero.
    const p = pipeline();
    stripCounterSteps(p, { varName: DOC_VAR, fieldId: `fid-${DOC_VAR}` });
    const json = JSON.stringify(p);
    for (const [n, tag] of COUNTS) {
      if (tag === TAG) continue;
      expect(json).toContain(varFor(n));
    }
    expect(json).not.toContain(DOC_VAR);
  });

  it("keeps the loop and the tile binding that carry the other counts", () => {
    const p = pipeline();
    stripCounterSteps(p, { varName: DOC_VAR, fieldId: `fid-${DOC_VAR}` });
    const loop = p.steps.find((s) => s.type === "loop");
    expect(loop).toBeTruthy();
    expect(loop.body[0].then).toHaveLength(COUNTS.length - 1);
    expect(p.steps.some((s) => s.config?.name === "$tile")).toBe(true);
  });

  it("is idempotent — a second pass removes nothing", () => {
    const p = pipeline();
    stripCounterSteps(p, { varName: DOC_VAR, fieldId: `fid-${DOC_VAR}` });
    expect(stripCounterSteps(p, { varName: DOC_VAR, fieldId: `fid-${DOC_VAR}` })).toBe(0);
  });
});

describe("the selector", () => {
  it("keys on 0238's marker, not on the tag a user could apply by hand", () => {
    expect(KEY_PREFIX).toBe("documentary|");
    expect(FIELD_NAME).toBe("Documentaries Owned");
  });
});

describe("isDocumentary — the selector that deleted 3,579 rows instead of 1,822", () => {
  it("matches only documentary keys", () => {
    expect(isDocumentary("documentary|ancientknowledge")).toBe(true);
    expect(isDocumentary("movie|johnwick2014")).toBe(false);
    expect(isDocumentary("book|watchmen")).toBe(false);
    expect(isDocumentary("musicAlbum|ballbreaker")).toBe(false);
  });

  it("is a PLAIN STRING TEST, so the `|` in the prefix cannot act as alternation", () => {
    // The bug: `{ $regex: "^" + KEY_PREFIX }` is `^documentary|`, which reads as
    // "starts with documentary OR the empty string" and matches EVERYTHING.
    // This is the regression test for that, expressed the way the bug appeared.
    expect(KEY_PREFIX).toContain("|");
    const asRegex = new RegExp(`^${KEY_PREFIX}`);
    expect(asRegex.test("movie|johnwick")).toBe(true);      // the DEFECT, pinned
    expect(isDocumentary("movie|johnwick")).toBe(false);    // the FIX
  });

  it("refuses a non-string key rather than throwing", () => {
    expect(isDocumentary(undefined)).toBe(false);
    expect(isDocumentary(null)).toBe(false);
    expect(isDocumentary(123)).toBe(false);
  });
});
