// 0338's two planners. The RENDERING half of this repair is measured through
// the real chart functions in `client/src/__tests__/wheelSpecRestored.test.js`;
// this pins the data the migration writes.
import { describe, it, expect } from "vitest";
import { planGraphSpec, repointGraphFind }
  from "../migrations/0338-the-rebuilt-wheel-lost-its-spec.mjs";
import { LABEL_FONT_PX, LABEL_MIN_ARC_PX } from "../migrations/0138-wheel-outer-ring-labels.mjs";
import { buildGraphSpec } from "../migrations/0046-emotions-wheel-graph.mjs";

// What 0046 mints, which is what the 2026-09-09 rebuild left on the wheel.
const bare = () => ({ type: "sunburst", encoding: { parent: "p", level: "l" }, literals: [] });
const want = { dayFieldId: "f-date", valueFieldId: "f-mood" };

describe("0338 planGraphSpec", () => {
  it("restores all five keys the rebuild dropped", () => {
    const { next, missing } = planGraphSpec(bare(), want);
    expect(missing.sort()).toEqual(
      ["dayFieldId", "hideTooltipValue", "labelFontPx", "labelMinArcPx", "valueFieldId"]);
    expect(next.dayFieldId).toBe("f-date");
    expect(next.valueFieldId).toBe("f-mood");
    expect(next.labelFontPx).toBe(LABEL_FONT_PX);
    expect(next.labelMinArcPx).toBe(LABEL_MIN_ARC_PX);
    expect(next.hideTooltipValue).toBe(true);
  });

  it("KEEPS the encoding and the literals — the rebuild got those right", () => {
    // The discriminating case: a plan that replaced the spec would silently
    // unhook the wheel's hierarchy from its Parent Emotion field.
    const { next } = planGraphSpec(bare(), want);
    expect(next.encoding).toEqual({ parent: "p", level: "l" });
    expect(next.literals).toEqual([]);
    expect(next.type).toBe("sunburst");
  });

  it("returns null when everything is already right — the re-run guard", () => {
    const { next } = planGraphSpec(bare(), want);
    expect(planGraphSpec(next, want)).toBeNull();
  });

  it("names only what is actually absent on a half-applied wheel", () => {
    // A migration may run against a grid where an earlier attempt threw.
    const half = { ...bare(), dayFieldId: "f-date", labelFontPx: LABEL_FONT_PX };
    expect(planGraphSpec(half, want).missing.sort())
      .toEqual(["hideTooltipValue", "labelMinArcPx", "valueFieldId"]);
  });

  it("re-points a field id that has CHANGED rather than treating it as present", () => {
    const stale = { ...planGraphSpec(bare(), want).next, valueFieldId: "f-old-mood" };
    expect(planGraphSpec(stale, want).missing).toEqual(["valueFieldId"]);
    expect(planGraphSpec(stale, want).next.valueFieldId).toBe("f-mood");
  });

  it("plans from nothing at all", () => {
    expect(planGraphSpec(undefined, want).next.valueFieldId).toBe("f-mood");
  });
});

const findStep = (right) => ({
  id: "s1", type: "action", actionType: "FIND",
  config: { over: "$allOccurrences", itemVar: "$graph",
    predicate: { conjunction: "AND", rules: [{ left: "id", comparator: "IS", right }] } },
});
const pipelineWith = (step) => ({ sources: [], steps: [
  { id: "outer", type: "if", condition: { rules: [] }, then: [step], else: [] },
] });

describe("0338 repointGraphFind", () => {
  it("re-points the FIND at the live wheel", () => {
    const { pipeline, changed } = repointGraphFind(pipelineWith(findStep("dead-id")), "live-id");
    expect(changed).toBe(1);
    expect(pipeline.steps[0].then[0].config.predicate.rules[0].right).toBe("live-id");
  });

  it("reports 0 changes when it already names the live wheel — re-run safe", () => {
    expect(repointGraphFind(pipelineWith(findStep("live-id")), "live-id").changed).toBe(0);
  });

  it("finds it inside a LOOP body, not only inside an if", () => {
    const p = { steps: [{ id: "l", type: "loop", overExpr: "$x", as: "$y", body: [findStep("dead")] }] };
    expect(repointGraphFind(p, "live-id").pipeline.steps[0].body[0]
      .config.predicate.rules[0].right).toBe("live-id");
  });

  it("THROWS when there is no $graph FIND — a silent no-op is the failure mode", () => {
    // A patcher that finds nothing leaves an operation that looks repaired.
    expect(() => repointGraphFind({ steps: [] }, "live-id")).toThrow(/found 0/);
  });

  it("THROWS on two of them rather than guessing which one", () => {
    const p = { steps: [findStep("a"), findStep("b")] };
    expect(() => repointGraphFind(p, "live-id")).toThrow(/found 2/);
  });

  it("leaves a FIND into a DIFFERENT variable alone", () => {
    const keep = findStep("keep-me");
    const other = { ...keep, config: { ...keep.config, itemVar: "$col" } };
    const p = { steps: [findStep("dead"), other] };
    const out = repointGraphFind(p, "live-id").pipeline;
    expect(out.steps[1].config.predicate.rules[0].right).toBe("keep-me");
  });
});

// THE ROOT CAUSE, guarded at its source. 0046 is re-run as the authoritative
// builder (0296 rebuilt the wheel with it), so a spec it mints short is a spec
// the next rebuild silently reverts to — which is the whole of 0338. If this
// fails, the rebuild has started dropping migrations again.
describe("0046 mints a COMPLETE spec, so a rebuild carries it", () => {
  const mint = () => buildGraphSpec({
    parentFieldId: "p", levelFieldId: "l", moodFieldId: "f-mood", dateFieldId: "f-date",
  });

  it("needs no repair from 0338", () => {
    expect(planGraphSpec(mint(), want)).toBeNull();
  });

  it("carries the label sizing 0138 measured", () => {
    expect(mint().labelFontPx).toBe(LABEL_FONT_PX);
    expect(mint().labelMinArcPx).toBe(LABEL_MIN_ARC_PX);
    expect(mint().hideTooltipValue).toBe(true);
  });

  it("OMITS the two field keys when the grid has no Mood or Date", () => {
    // A key holding null is a graph configured to derive that cannot —
    // `derivesSelection` asks for both, so half a pair is worse than neither.
    const partial = buildGraphSpec({ parentFieldId: "p", levelFieldId: "l", moodFieldId: "f-mood" });
    expect("valueFieldId" in partial).toBe(false);
    expect("dayFieldId" in partial).toBe(false);
  });

  it("still builds the hierarchy from the two encoding fields", () => {
    expect(mint().encoding.parent).toBe("p");
    expect(mint().encoding.level).toBe("l");
    expect(mint().type).toBe("sunburst");
  });
});
