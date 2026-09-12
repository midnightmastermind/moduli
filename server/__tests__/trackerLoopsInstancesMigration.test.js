// 0331 — tracker loops iterate $allInstances, for the ops measured equivalent.
import { describe, it, expect } from "vitest";
import {
  EQUIVALENT_OPS, NOT_EQUIVALENT, countAllItemsLoops, swapLoopsToInstances, planSwap,
} from "../migrations/0331-trackers-loop-instances.mjs";

const loop = (over, body = []) => ({ id: "l", type: "loop", overExpr: over, as: "$item", body });
const trackerPipeline = () => ({ steps: [
  { id: "a", type: "action", config: { type: "INIT_VAR", name: "$goalItem", expr: "$allItemsById.tile1" } },
  { id: "f", type: "action", config: { type: "FIND", over: "$allItems", predicate: { operator: "AND", rules: [] }, itemVar: "$x" } },
  { id: "i", type: "if", condition: { operator: "AND", rules: [] }, then: [
    loop("$allItems", [{ id: "g", type: "if", condition: { operator: "AND", rules: [] }, then: [], else: [] }]),
    loop("$allItems"),
  ], else: [loop("$allContainers")] },
]});

describe("swapLoopsToInstances", () => {
  it("swaps every $allItems LOOP, however deeply nested", () => {
    const p = trackerPipeline();
    expect(swapLoopsToInstances(p)).toBe(2);
    expect(countAllItemsLoops(p)).toBe(0);
  });

  it("leaves a FIND over $allItems, an $allItemsById expr and other collections alone", () => {
    const p = trackerPipeline();
    swapLoopsToInstances(p);
    expect(p.steps[0].config.expr).toBe("$allItemsById.tile1");
    expect(p.steps[1].config.over).toBe("$allItems");
    expect(p.steps[2].else[0].overExpr).toBe("$allContainers");
  });

  it("is idempotent", () => {
    const p = trackerPipeline();
    swapLoopsToInstances(p);
    expect(swapLoopsToInstances(p)).toBe(0);
  });
});

describe("planSwap", () => {
  const every = () => EQUIVALENT_OPS.map((name) => ({ name, pipeline: trackerPipeline() }));

  it("plans every named op and nothing else", () => {
    const ops = [...every(), ...NOT_EQUIVALENT.map((name) => ({ name, pipeline: trackerPipeline() }))];
    const { plan, missing, ambiguous } = planSwap(ops);
    expect(plan.map((p) => p.op.name).sort()).toEqual([...EQUIVALENT_OPS].sort());
    expect(missing).toEqual([]);
    expect(ambiguous).toEqual([]);
  });

  it("NEVER plans the two ops that measured different — the discriminating case", () => {
    const ops = [...every(), ...NOT_EQUIVALENT.map((name) => ({ name, pipeline: trackerPipeline() }))];
    const planned = planSwap(ops).plan.map((p) => p.op.name);
    for (const n of NOT_EQUIVALENT) expect(planned).not.toContain(n);
  });

  it("the two lists are disjoint", () => {
    expect(EQUIVALENT_OPS.filter((n) => NOT_EQUIVALENT.includes(n))).toEqual([]);
    expect(EQUIVALENT_OPS).toHaveLength(25);
  });

  it("reports a converged op, a missing op and an ambiguous op instead of guessing", () => {
    const ops = every();
    swapLoopsToInstances(ops[0].pipeline);            // already done
    ops.splice(1, 1);                                  // missing
    ops.push({ name: EQUIVALENT_OPS[2], pipeline: trackerPipeline() }); // ambiguous
    const r = planSwap(ops);
    expect(r.converged).toEqual([EQUIVALENT_OPS[0]]);
    expect(r.missing).toEqual([EQUIVALENT_OPS[1]]);
    expect(r.ambiguous).toEqual([EQUIVALENT_OPS[2]]);
  });
});
