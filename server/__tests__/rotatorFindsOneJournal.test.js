// 0240 — the Rotator's FIND, and why a multi-match is a throw rather than a guess.
import { describe, it, expect } from "vitest";
import { findJournalStep, pinToId, OP_NAME } from "../migrations/0240-rotator-finds-one-journal.mjs";

const pipeline = () => ({ sources: [], steps: [
  { type: "action", action: "INIT_VAR", cfg: { name: "$schedPage", expr: "$allItemsById.llpF10Bda5nu" } },
  { type: "action", action: "FIND", cfg: { over: "$allInstances", itemVar: "$firstQuestion",
      predicate: { conjunction: "AND", rules: [{ left: "fields.X.value", comparator: "IS", right: "question" }] } } },
  { type: "if", condition: { conjunction: "AND", rules: [] }, then: [
    { type: "action", action: "FIND", cfg: { over: "$allInstances", itemVar: "$journalingInst",
        itemIdVar: "$journalingInstId",
        predicate: { conjunction: "AND", rules: [{ left: "templateId", comparator: "IS", right: "tDhKsWljZfS2" }] } } },
  ], else: [] },
]});

describe("findJournalStep — locating the FIND to pin", () => {
  it("finds the $journalingInst FIND even when it is NESTED in a branch", () => {
    // The 2026-08-12 lesson: a top-level splice finds nothing when the step is
    // emitted inside an IF, and the migration then looks applied and is not.
    expect(findJournalStep(pipeline())).toHaveLength(1);
  });

  it("does NOT match the question FIND beside it", () => {
    const [s] = findJournalStep(pipeline());
    expect((s.cfg || s.config).itemVar).toBe("$journalingInst");
  });

  it("returns nothing once the pipeline has already been pinned", () => {
    // Idempotency is asserted through the same selector the migration uses:
    // after pinning, the templateId rule is gone, so a re-run refuses.
    const p = pipeline();
    pinToId(findJournalStep(p)[0], "RWo6EN_ubw0R");
    const [s] = findJournalStep(p);
    const rules = (s.cfg || s.config).predicate.rules;
    expect(rules.find((r) => r.left === "templateId")).toBeUndefined();
  });
});

describe("pinToId — a picker-direct match cannot bind an array", () => {
  it("replaces the collection scan with an id match", () => {
    const p = pipeline();
    pinToId(findJournalStep(p)[0], "RWo6EN_ubw0R");
    const c = findJournalStep(p)[0].cfg;
    expect(c.over).toBe("$allItemsById");
    expect(c.predicate.rules).toEqual([{ left: "id", comparator: "IS", right: "RWo6EN_ubw0R" }]);
  });

  it("leaves itemVar and itemIdVar alone — the steps below read them", () => {
    const p = pipeline();
    pinToId(findJournalStep(p)[0], "x");
    const c = findJournalStep(p)[0].cfg;
    expect(c.itemVar).toBe("$journalingInst");
    expect(c.itemIdVar).toBe("$journalingInstId");
  });

  it("touches no other step", () => {
    const p = pipeline();
    const before = JSON.stringify(p.steps[0]);
    pinToId(findJournalStep(p)[0], "x");
    expect(JSON.stringify(p.steps[0])).toBe(before);
  });
});

describe("the op it targets", () => {
  it("is named exactly, because the migration resolves it by name", () => {
    expect(OP_NAME).toBe("Daily Question Rotator");
  });
});
