import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext";

// Hoist-aware mock — vi.mock factories can't reference test-scope variables.
// Track invocations on a module-scope sentinel and re-import the mocks inside
// tests when needed.
const mockRun = vi.fn(() => []);
vi.mock("../helpers/operationExecutor", () => ({
  runMatchingOperations: (...args) => mockRun(...args),
}));
vi.mock("../state/actions", () => ({
  setComputedValuesAction: (updates) => ({ type: "SET_COMPUTED_VALUES", updates }),
}));

// Import after the mocks so the module picks them up.
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

describe("Field — button type (#46 polish)", () => {
  it("renders the button with the field's name when no buttonLabel meta", () => {
    const field = { id: "fb1", type: "button", name: "Show Profile", meta: { operationId: "op-x" } };
    const { container } = renderWithCtx(
      <Field field={field} hostOccurrence={{ id: "occ-1" }} />,
      { operationsById: { "op-x": { id: "op-x", name: "Show Profile" } } },
    );
    const btn = container.querySelector("button");
    expect(btn).toBeTruthy();
    expect(btn.textContent).toMatch(/Show Profile/);
    expect(btn.disabled).toBe(false);
  });

  it("uses meta.buttonLabel when provided (overrides field.name)", () => {
    const field = { id: "fb2", type: "button", name: "Internal Name", meta: { operationId: "op-x", buttonLabel: "Run Pomodoro" } };
    const { container } = renderWithCtx(
      <Field field={field} hostOccurrence={{ id: "occ-1" }} />,
      { operationsById: { "op-x": { id: "op-x" } } },
    );
    expect(container.querySelector("button").textContent).toMatch(/Run Pomodoro/);
  });

  it("disables the button when the referenced operation is missing", () => {
    const field = { id: "fb3", type: "button", name: "Click", meta: { operationId: "nope" } };
    const { container } = renderWithCtx(
      <Field field={field} hostOccurrence={{ id: "occ-1" }} />,
      { operationsById: {} },
    );
    expect(container.querySelector("button").disabled).toBe(true);
  });

  it("disables the button when no meta.operationId is configured", () => {
    const field = { id: "fb4", type: "button", name: "Click", meta: {} };
    const { container } = renderWithCtx(<Field field={field} hostOccurrence={{ id: "occ-1" }} />);
    expect(container.querySelector("button").disabled).toBe(true);
  });

  it("respects the disabled prop", () => {
    const field = { id: "fb5", type: "button", name: "Click", meta: { operationId: "op-x" } };
    const { container } = renderWithCtx(
      <Field field={field} hostOccurrence={{ id: "occ-1" }} disabled={true} />,
      { operationsById: { "op-x": { id: "op-x" } } },
    );
    expect(container.querySelector("button").disabled).toBe(true);
  });

  it("on click fires a ButtonOp transaction with the host occurrence id", () => {
    mockRun.mockClear();
    const field = { id: "fb6", type: "button", name: "Show", meta: { operationId: "op-show" } };
    const op = { id: "op-show", name: "Show Profile" };
    const { container } = renderWithCtx(
      <Field field={field} hostOccurrence={{ id: "occ-row-7" }} />,
      { operationsById: { "op-show": op } },
    );

    fireEvent.click(container.querySelector("button"));

    expect(mockRun).toHaveBeenCalledTimes(1);
    const args = mockRun.mock.calls[0];
    // [operationsArray, eventType, transaction, context]
    expect(Array.isArray(args[0])).toBe(true);
    expect(args[1]).toBe("ButtonOp");
    expect(args[2]).toMatchObject({
      type: "ButtonOp",
      operationId: "op-show",
      occurrenceId: "occ-row-7",
      instanceId: "occ-row-7",
      fieldId: "fb6",
    });
    expect(args[3]).toMatchObject({ fieldsById: expect.any(Object), operationsById: expect.any(Object) });
  });

  it("dispatches computed-value updates for display-only effects", () => {
    mockRun.mockClear();
    mockRun.mockReturnValueOnce([
      { fieldId: "ftxt", value: "Hello" },
      { _effect: "SHOW_TOAST", message: "ignored" },
    ]);
    const field = { id: "fb7", type: "button", name: "Run", meta: { operationId: "op-x" } };
    const { ctx, container } = renderWithCtx(
      <Field field={field} hostOccurrence={{ id: "occ-1" }} />,
      { operationsById: { "op-x": { id: "op-x" } } },
    );

    fireEvent.click(container.querySelector("button"));

    expect(ctx.dispatch).toHaveBeenCalledTimes(1);
    const action = ctx.dispatch.mock.calls[0][0];
    expect(action.type).toBe("SET_COMPUTED_VALUES");
    // Only the non-_effect entry should land in displayUpdates.
    expect(action.updates).toEqual([{ fieldId: "ftxt", value: "Hello" }]);
  });

  it("click is a no-op when the operation is missing (no dispatch, no executor call)", () => {
    mockRun.mockClear();
    const field = { id: "fb8", type: "button", name: "Click", meta: { operationId: "missing" } };
    const { ctx, container } = renderWithCtx(
      <Field field={field} hostOccurrence={{ id: "occ-1" }} />,
      { operationsById: {} },
    );

    fireEvent.click(container.querySelector("button"));

    expect(mockRun).not.toHaveBeenCalled();
    expect(ctx.dispatch).not.toHaveBeenCalled();
  });
});
