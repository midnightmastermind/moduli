import { describe, it, expect } from "vitest";
import { repointCountTile } from "../migrations/0190-liquid-intake-and-meal-count-moves.mjs";

const FROM = "k60u6wnkt9", TO = "7XKtH0inSuve";
const pipeline = () => ({ steps: [
  { id: "a", type: "action", config: { type: "INIT_VAR", name: "$countTile", expr: `$allItemsById.${FROM}` } },
  { id: "b", type: "loop", body: [
    { id: "c", type: "if", then: [
      { id: "d", type: "action", config: { type: "UPDATE", path: "$countTile.fields.cherqzr2eg.value", value: "$meals" } },
    ], else: [] },
  ] },
] });

describe("0190 — moving Meal Count's write with its binding", () => {
  it("repoints the INIT_VAR that names the old tile", () => {
    const p = pipeline();
    expect(repointCountTile(p, { fromOccId: FROM, toOccId: TO })).toBe(1);
    expect(p.steps[0].config.expr).toBe(`$allItemsById.${TO}`);
  });

  it("leaves the UPDATE alone — it writes through the VAR, which is the whole point", () => {
    const p = pipeline();
    repointCountTile(p, { fromOccId: FROM, toOccId: TO });
    expect(p.steps[1].body[0].then[0].config.path).toBe("$countTile.fields.cherqzr2eg.value");
  });

  it("recurses into then / else / body — an INIT_VAR is not always top-level", () => {
    const p = { steps: [{ id: "x", type: "if", then: [
      { id: "y", type: "action", config: { type: "INIT_VAR", name: "$t", expr: `$allItemsById.${FROM}` } },
    ], else: [] }] };
    expect(repointCountTile(p, { fromOccId: FROM, toOccId: TO })).toBe(1);
  });

  it("reports 0 when nothing names the old tile — the caller then REFUSES", () => {
    // Returning 0 rather than silently succeeding is what stops a binding moving to a
    // tile nothing writes — the `0184` tile this repo just deleted.
    const p = pipeline();
    expect(repointCountTile(p, { fromOccId: "nope", toOccId: TO })).toBe(0);
  });

  it("touches only INIT_VAR — an action that READS from the old tile keeps reading it", () => {
    // The discriminating case. Loosening this to "any config.expr mentioning the id" looks
    // harmless and is not: a step that reads a VALUE off the Intake tile would be silently
    // repointed at Meal Log, which holds no such value. Only the INIT_VAR that binds the
    // WRITE TARGET may move.
    const p = { steps: [
      { id: "a", type: "action", config: { type: "ADD_TO_VAR", name: "$w", expr: `$allItemsById.${FROM}.fields.water.value` } },
      { id: "b", type: "action", config: { type: "FIND", predicate: { rules: [{ right: FROM }] } } },
    ] };
    expect(repointCountTile(p, { fromOccId: FROM, toOccId: TO })).toBe(0);
    expect(p.steps[0].config.expr).toContain(FROM);
    expect(p.steps[1].config.predicate.rules[0].right).toBe(FROM);
  });
});
