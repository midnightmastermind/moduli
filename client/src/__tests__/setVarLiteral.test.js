// SET_VAR resolves whichever key the step carries — `expr` OR `value`.
//
// USER, 2026-08-19: *"the schedule for today only created 5am and beyond
// again."* The slots were all there (48, 12:00am–11:30pm, none unlisted); what
// was missing was their CONTENTS. `Schedule: Place Cycle Day` — the op that
// places the day's meals and movements — ran on every load and emitted NOTHING.
//
// It exited at its own gate. The op opens:
//
//     SET_VAR   $mine  = "literal:1"
//     INIT_VAR  $mine2 = $mine
//     IF        $mine2 IS "1"        <- never true
//
// `resolveExpr` is what strips a `literal:` prefix, and SET_VAR passed it
// `cfg.expr` only, falling back to the RAW `cfg.value`. So `$mine` held the
// nine-character string "literal:1", the gate failed, and the whole body was
// skipped — silently, with the op reporting a clean run.
//
// THE SAME DEFECT IS ALREADY DOCUMENTED ONE CASE BELOW, on MULTIPLY_VAR: "was
// `expr`-only, so a caller passing `by: 240` got resolveExpr(undefined) → NaN →
// the multiply silently no-op'd". Two actions, one mistake, both silent.
//
// Measured on poms grid before the fix: 55 stored SET_VAR steps — 38 on `expr`
// (correct), 17 on `value`, of which 16 were wrong. Driving the real load sweep
// over the grid's own fixture, the cycle op went 0 effects → 16.
import { describe, it, expect } from "vitest";
import { executeActionItem } from "../helpers/operationActions";

// `executeActionItem(type, cfg, $vars, context, transaction)` — POSITIONAL.
// Calling it with a config object first threw `Cannot destructure property
// 'state' of 'context'`, which reads exactly like a broken fix. Check the
// signature before believing the failure.
const run = (cfg, $vars = {}) => {
  executeActionItem(cfg.type, cfg, $vars, {
    state: {}, fieldsById: {}, occurrencesById: {}, operationsById: {}, modulesById: {},
  }, null);
  return $vars;
};

describe("SET_VAR", () => {
  it("strips a literal: prefix given as `value` — the schedule bug", () => {
    expect(run({ type: "SET_VAR", name: "$x", value: "literal:1" }).$x).toBe(1);
    expect(run({ type: "SET_VAR", name: "$x", value: "literal:Day 1" }).$x).toBe("Day 1");
  });

  it("still strips it given as `expr` — the path that already worked", () => {
    expect(run({ type: "SET_VAR", name: "$x", expr: "literal:1" }).$x).toBe(1);
  });

  it("resolves a $path given as `value`, not just as `expr`", () => {
    expect(run({ type: "SET_VAR", name: "$x", value: "$src" }, { $src: 42 }).$x).toBe(42);
    expect(run({ type: "SET_VAR", name: "$x", expr: "$src" }, { $src: 42 }).$x).toBe(42);
  });

  // The 17th `value`-only step on the live grid is the bare number 7. Routing
  // it through resolveExpr must not change it — non-strings are literals.
  it("leaves a non-string value alone", () => {
    expect(run({ type: "SET_VAR", name: "$x", value: 7 }).$x).toBe(7);
    expect(run({ type: "SET_VAR", name: "$x", value: 0 }).$x).toBe(0);
  });

  it("prefers `expr` when a step carries both", () => {
    expect(run({ type: "SET_VAR", name: "$x", expr: "literal:a", value: "literal:b" }).$x).toBe("a");
  });

  it("resolves to null rather than undefined when there is nothing to resolve", () => {
    expect(run({ type: "SET_VAR", name: "$x" }).$x).toBeNull();
  });
});
