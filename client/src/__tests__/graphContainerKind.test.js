// __tests__/graphContainerKind.test.js
//
// A graph container could not be MADE through the UI. Measured on a fresh
// account 2026-08-18: the add-container menu offers Board / Document / Canvas /
// Table, and the convert menu offers the same four — while every container's
// header dropdown carries the whole GraphSection (chart type, label, value, a
// live "9 roots · 9 rows" readout) and ContainerGraph renders `kind: "graph"`.
// So a person could configure a chart in full and never see one; the only
// graphs in existence were minted by migrations.
//
// board → graph is a plain kind flip: both render from the occurrence's own
// children / feed, so there is no textmap surgery to do. The doc arm is what
// needs care, and it is unchanged.
import { describe, it, expect } from "vitest";
import { planContainerKindConversion, CONVERTIBLE_CONTAINER_KINDS } from "../helpers/convertOccurrence";

describe("container kind conversion", () => {
  it("offers graph as a kind a container can become", () => {
    expect(CONVERTIBLE_CONTAINER_KINDS).toContain("graph");
  });

  it("board → graph flips the kind and leaves the children alone", () => {
    const plan = planContainerKindConversion({
      occurrence: { id: "o1", occurrences: ["a", "b"], textmap: null },
      module: { id: "m1", kind: "board", role: "container" },
      targetKind: "graph",
    });
    expect(plan.modulePatch.kind).toBe("graph");
    expect(plan.occurrencePatch).toBeNull();          // nothing to rewrite
  });

  it("doc → graph drops the doc textmap, like every other doc → non-doc flip", () => {
    const plan = planContainerKindConversion({
      occurrence: { id: "o1", occurrences: ["a"], textmap: { type: "doc", content: [] } },
      module: { id: "m1", kind: "doc", role: "container" },
      targetKind: "graph",
    });
    expect(plan.modulePatch.kind).toBe("graph");
    expect(plan.occurrencePatch.textmap).toBeNull();
  });

  // The control: an unknown kind is still refused, so "graph is allowed" is a
  // real entry in the list rather than the guard having been removed.
  it("still refuses a kind that is not in the list", () => {
    expect(planContainerKindConversion({
      occurrence: { id: "o1" }, module: { id: "m1", kind: "board" }, targetKind: "sunburst",
    })).toBeNull();
  });
});
