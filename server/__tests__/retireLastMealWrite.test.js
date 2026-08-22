// `stripVar` — removing a variable from a pipeline at every depth.
//
// The defect it exists for: `Meal History` computed `Last Meal` on every load and
// wrote it onto a tile that binds nothing (0190 removed the binding on the user's
// instruction). Removing only the UPDATE would leave a SET_VAR firing on every
// loop iteration for a variable nobody reads — the same defect one layer down.
import { describe, it, expect } from "vitest";
import { stripVar } from "../migrations/0191-retire-the-last-meal-write.mjs";

const S = (config, extra = {}) => ({ config, ...extra });

function pipeline() {
  return { steps: [
    S({ type: "INIT_VAR", name: "$rows", value: [] }),
    S({ type: "INIT_VAR", name: "$lastM", value: "" }),
    S({ type: "LOOP", over: "$allInstances" }, { body: [
      S({ type: "IF" }, { then: [
        S({ type: "PUSH_TO_ARRAY", name: "$rows", value: { label: "$inst.label" } }),
        S({ type: "SET_VAR", name: "$lastM", expr: "$inst.label" }),
      ] }),
    ] }),
    S({ type: "UPDATE", path: "$goalItem.fields.ROWS.value", value: "$rows" }),
    S({ type: "UPDATE", path: "$goalItem.fields.LAST.value", value: "$lastM" }),
  ] };
}

describe("stripVar", () => {
  it("removes all three sites — the init, the in-loop set, and the write", () => {
    const { removed } = stripVar(pipeline(), "$lastM");
    expect(removed.sort()).toEqual(["INIT_VAR", "SET_VAR", "UPDATE"]);
  });

  it("reaches INSIDE a loop body and an if-branch", () => {
    const { pipeline: next } = stripVar(pipeline(), "$lastM");
    expect(JSON.stringify(next)).not.toContain("$lastM");
  });

  it("KEEPS the loop and the branch that held it", () => {
    // The bug this guards: a naive filter drops any step whose subtree mentions
    // the variable, taking the whole loop — and with it the $rows accumulation
    // the tile actually renders.
    const { pipeline: next } = stripVar(pipeline(), "$lastM");
    const loop = next.steps.find((s) => s.config.type === "LOOP");
    expect(loop).toBeTruthy();
    expect(loop.body[0].config.type).toBe("IF");
    expect(loop.body[0].then).toHaveLength(1);
    expect(loop.body[0].then[0].config.type).toBe("PUSH_TO_ARRAY");
  });

  it("leaves the OTHER write alone — the discriminator is the variable, not the op", () => {
    const { pipeline: next } = stripVar(pipeline(), "$lastM");
    const writes = next.steps.filter((s) => s.config.type === "UPDATE");
    expect(writes).toHaveLength(1);
    expect(writes[0].config.path).toContain("ROWS");
  });

  it("a variable that is not there removes nothing — the control", () => {
    // Without this, a stripVar that removed everything would pass every test
    // above, since they only assert what is GONE.
    const { pipeline: next, removed } = stripVar(pipeline(), "$nosuchvar");
    expect(removed).toEqual([]);
    expect(JSON.stringify(next)).toEqual(JSON.stringify(pipeline()));
  });

  it("does not mutate the pipeline it was handed", () => {
    const original = pipeline();
    const snapshot = JSON.stringify(original);
    stripVar(original, "$lastM");
    expect(JSON.stringify(original)).toEqual(snapshot);
  });

  // `$last` is a PREFIX of `$lastM`. Both directions are tested because only
  // one of them silently loses work, and it is not the obvious one.
  const twoVars = () => ({ steps: [
    S({ type: "INIT_VAR", name: "$last", value: "" }),
    S({ type: "SET_VAR", name: "$lastM", expr: "x" }),
  ] });

  it("stripping the LONGER name leaves the shorter one", () => {
    const { removed, pipeline: next } = stripVar(twoVars(), "$lastM");
    expect(removed).toEqual(["SET_VAR"]);
    expect(JSON.stringify(next)).toContain("$last");
  });

  it("stripping the SHORTER name does NOT take the longer one — the dangerous direction", () => {
    // A plain `includes("$last")` matches "$lastM" and deletes both. This is
    // the case that costs data, and it is the reason the match is boundaried.
    const { removed, pipeline: next } = stripVar(twoVars(), "$last");
    expect(removed).toEqual(["INIT_VAR"]);
    expect(JSON.stringify(next)).toContain("$lastM");
  });
});
