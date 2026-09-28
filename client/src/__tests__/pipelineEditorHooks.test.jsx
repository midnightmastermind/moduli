// The pipeline editor names each step list and each step in the DOM, so a
// nested block (a loop body, an IF's then/else) and its own footer can be
// addressed directly rather than by "the first then" / "the last + Action".
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { PipelineEditor } from "../blocks/OperationsBuilder";

const pipeline = { sources: [], steps: [
  { id: "L1", type: "loop", overExpr: "$allInstances", as: "$item", body: [
    { id: "I1", type: "if", condition: { operator: "AND", rules: [] }, then: [{ id: "A1", type: "action", config: { type: "INIT_VAR", name: "$x", expr: "0" } }], else: [] },
  ] },
] };

describe("pipeline editor DOM hooks", () => {
  it("names every step list by its owner and branch", () => {
    const { container } = render(<PipelineEditor pipeline={pipeline} onChange={vi.fn()} fields={[]} />);
    const owners = [...container.querySelectorAll("[data-steps-of]")].map((e) => e.getAttribute("data-steps-of"));
    expect(owners).toEqual(expect.arrayContaining(["root", "L1:body", "I1:then"]));
  });
  it("names every step, and a list's own footer is reachable inside it", () => {
    const { container } = render(<PipelineEditor pipeline={pipeline} onChange={vi.fn()} fields={[]} />);
    expect(container.querySelector('[data-step-id="A1"]')).toBeTruthy();
    const thenList = container.querySelector('[data-steps-of="I1:then"]');
    expect([...thenList.querySelectorAll(":scope > div:last-child button")].map((b) => b.textContent)).toEqual(["+ Action", "+ If", "+ Loop"]);
  });
});
