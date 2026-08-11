// 0068 deletes occurrences from protected live data and rewrites a stored
// pipeline, so the tests weigh what it REFUSES over what it does.
//
// The template resolver gets the most coverage because its first draft was
// WRONG in the most dangerous way: it grepped the first `$allItemsById.<id>` in
// the pipeline, resolved the Schedule page, and the dry run still read
// plausibly ("template already does not list the graph"). A selector that
// matches the wrong thing confidently is the `0035` class.
import { describe, it, expect } from "vitest";
import {
  resolveTemplateId, isEmptyClone, addSharedChildStep,
} from "../migrations/0068-one-shared-emotions-wheel.mjs";

const act = (config) => ({ id: "s" + Math.random(), type: "action", config });

// The real shape: the op names the Schedule FIRST, then the template.
const REAL_PIPELINE = {
  steps: [
    act({ type: "INIT_VAR", name: "$sched", expr: "$allItemsById.llpF10Bd" }),
    act({ type: "INIT_VAR", name: "$tpl", expr: "$allItemsById.ktMxTVErceWq" }),
    act({ type: "INIT_VAR", name: "$tplId", expr: "$tpl.id" }),
    {
      id: "loop", type: "loop", body: [
        act({ type: "APPLY_TEMPLATE", templateRef: "$tplId", targetOccurrenceVar: "$colId", mode: "merge" }),
        act({ type: "UPDATE", path: "$col.meta.appliedFromTemplateId", value: "$tplId" }),
      ],
    },
  ],
};

describe("0068 resolveTemplateId", () => {
  // The regression that produced this function.
  it("follows the VARIABLE, not the first $allItemsById in the pipeline", () => {
    expect(resolveTemplateId(REAL_PIPELINE)).toBe("ktMxTVErceWq");
  });

  it("resolves a templateRef bound directly, with no deref hop", () => {
    const p = { steps: [
      act({ type: "INIT_VAR", name: "$t", expr: "$allItemsById.abc123" }),
      act({ type: "APPLY_TEMPLATE", templateRef: "$t" }),
    ]};
    expect(resolveTemplateId(p)).toBe("abc123");
  });

  it("returns null rather than guessing when the chain does not end in $allItemsById", () => {
    const p = { steps: [
      act({ type: "INIT_VAR", name: "$tplId", expr: "$somethingElse.id" }),
      act({ type: "APPLY_TEMPLATE", templateRef: "$tplId" }),
    ]};
    expect(resolveTemplateId(p)).toBeNull();
  });

  it("returns null when no APPLY_TEMPLATE names a template", () => {
    expect(resolveTemplateId({ steps: [act({ type: "INIT_VAR", name: "$tpl", expr: "$allItemsById.x" })] })).toBeNull();
  });

  it("terminates on a cyclic var chain instead of hanging", () => {
    const p = { steps: [
      act({ type: "INIT_VAR", name: "$a", expr: "$b.id" }),
      act({ type: "INIT_VAR", name: "$b", expr: "$a.id" }),
      act({ type: "APPLY_TEMPLATE", templateRef: "$a" }),
    ]};
    expect(resolveTemplateId(p)).toBeNull();
  });

  it("finds a template bound inside a nested branch", () => {
    const p = { steps: [{ id: "if", type: "if", then: [
      act({ type: "INIT_VAR", name: "$t", expr: "$allItemsById.deep99" }),
      act({ type: "APPLY_TEMPLATE", templateRef: "$t" }),
    ], else: [] }]};
    expect(resolveTemplateId(p)).toBe("deep99");
  });
});

describe("0068 isEmptyClone", () => {
  const base = { id: "c1", identitySignature: "daypage:Emotions Wheel", occurrences: [], meta: {} };
  const opts = { canonicalId: "canon" };

  it("accepts a signed clone with no children and no recorded selection", () => {
    expect(isEmptyClone(base, opts)).toBe(true);
  });

  it("REFUSES the canonical occurrence itself", () => {
    expect(isEmptyClone({ ...base, id: "canon" }, opts)).toBe(false);
  });

  // Each of these is user state. The predicate answers "provably empty",
  // never "looks like debris".
  it("REFUSES a clone that has children", () => {
    expect(isEmptyClone({ ...base, occurrences: ["kid"] }, opts)).toBe(false);
  });

  it("REFUSES a clone carrying a recorded selection", () => {
    expect(isEmptyClone({ ...base, meta: { graph: { highlight: ["joy"] } } }, opts)).toBe(false);
    expect(isEmptyClone({ ...base, meta: { graph: { highlight: "joy" } } }, opts)).toBe(false);
  });

  it("treats an EMPTY highlight array as no selection", () => {
    expect(isEmptyClone({ ...base, meta: { graph: { highlight: [] } } }, opts)).toBe(true);
  });

  it("REFUSES anything carrying a different signature", () => {
    expect(isEmptyClone({ ...base, identitySignature: "daypage:Journal" }, opts)).toBe(false);
    expect(isEmptyClone({ ...base, identitySignature: null }, opts)).toBe(false);
  });
});

describe("0068 addSharedChildStep", () => {
  const clone = () => JSON.parse(JSON.stringify(REAL_PIPELINE));

  it("inserts the ADD_CHILD directly AFTER the template stamp, where $colId is bound", () => {
    const op = { pipeline: clone() };
    const r = addSharedChildStep(op, "wheel-1");
    expect(r.added).toBe(1);
    const body = op.pipeline.steps[3].body;
    expect(body[1].config.path).toBe("$col.meta.appliedFromTemplateId");
    expect(body[2].config).toMatchObject({ type: "ADD_CHILD", parentId: "$colId", childId: "wheel-1" });
  });

  it("is idempotent — a second run adds nothing", () => {
    const op = { pipeline: clone() };
    addSharedChildStep(op, "wheel-1");
    const before = JSON.stringify(op.pipeline);
    const r = addSharedChildStep(op, "wheel-1");
    expect(r.added).toBe(0);
    expect(r.alreadyPresent).toBe(1);
    expect(JSON.stringify(op.pipeline)).toBe(before);
  });

  it("fails CLOSED with a reason when the anchor step is absent", () => {
    const op = { pipeline: { steps: [act({ type: "INIT_VAR", name: "$x", expr: "1" })] } };
    const r = addSharedChildStep(op, "wheel-1");
    expect(r.added).toBe(0);
    expect(r.reason).toMatch(/anchor/i);
  });

  it("fails CLOSED on an op with no pipeline", () => {
    expect(addSharedChildStep({}, "wheel-1").reason).toBeTruthy();
  });
});
