// Flow side-button on compact value pills (2026-07-11): a number field that
// opts in via field.meta.flowToggle renders the green/blue/red in/replace/out
// FlowToggle BESIDE the compact click-to-edit pill (at rest AND while editing,
// outside the blur-commit lifecycle); fields without the flag stay clean.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext";

import Field from "../ui/Field";

function renderWithCtx(node, ctxOverrides = {}) {
  const ctx = {
    dispatch: vi.fn(),
    socket: null,
    gridId: "g1",
    userId: "u1",
    occurrencesById: {},
    modulesById: {},
    fieldsById: {},
    operationsById: {},
    state: { grid: {} },
    ...ctxOverrides,
  };
  return {
    ctx,
    ...render(
      <GridActionsContext.Provider value={ctx}>{node}</GridActionsContext.Provider>
    ),
  };
}

const amountField = {
  id: "f-amt", type: "number", name: "Amount", inputEnabled: true,
  meta: { prefix: "$", flow: "out", flowToggle: true },
};

describe("Field — compact flow side-button (meta.flowToggle)", () => {
  it("renders the FlowToggle beside the compact pill when meta.flowToggle is set", () => {
    const { container } = renderWithCtx(
      <Field field={amountField} binding={{ role: "input" }} value={45}
        flow="out" compact onCommit={vi.fn()} onFlowChange={vi.fn()} />
    );
    const toggle = container.querySelector('button[title^="Flow:"]');
    expect(toggle).toBeTruthy();
    expect(toggle.title).toMatch(/Out/);
  });

  it("does NOT render the FlowToggle on compact pills without the flag", () => {
    const plain = { id: "f-w", type: "number", name: "Water", inputEnabled: true, meta: {} };
    const { container } = renderWithCtx(
      <Field field={plain} binding={{ role: "input" }} value={8}
        flow="in" compact onCommit={vi.fn()} onFlowChange={vi.fn()} />
    );
    expect(container.querySelector('button[title^="Flow:"]')).toBeNull();
  });

  it("keeps the FlowToggle mounted while the pill is in click-to-edit mode", () => {
    const { container } = renderWithCtx(
      <Field field={amountField} binding={{ role: "input" }} value={45}
        flow="replace" compact onCommit={vi.fn()} onFlowChange={vi.fn()} />
    );
    const pill = container.querySelector("button.field-input");
    fireEvent.click(pill);
    expect(container.querySelector("input")).toBeTruthy(); // editing
    const toggle = container.querySelector('button[title^="Flow:"]');
    expect(toggle).toBeTruthy();
    expect(toggle.title).toMatch(/Replace/);
  });

  it("selecting a flow option fires onFlowChange with the picked flow", () => {
    const onFlowChange = vi.fn();
    const { container, baseElement } = renderWithCtx(
      <Field field={amountField} binding={{ role: "input" }} value={45}
        flow="out" compact onCommit={vi.fn()} onFlowChange={onFlowChange} />
    );
    fireEvent.click(container.querySelector('button[title^="Flow:"]'));
    // Popover content portals to body — find the Replace option row.
    const options = Array.from(baseElement.querySelectorAll("button"))
      .filter(b => /Replace/.test(b.textContent));
    expect(options.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(options[0]);
    expect(onFlowChange).toHaveBeenCalledWith("replace");
  });
});
