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

const listener = (id, fieldId) => ({ id, name: `Op ${id}`, enabled: true, triggerTypes: ["onButton"],
  triggerObjects: [{ eventType: "onButton", subjectType: "field", targetId: fieldId }] });

describe("Field — button type", () => {
  it("renders the button with the field's name when no buttonLabel meta", () => {
    const field = { id: "fb1", type: "button", name: "Show Profile", meta: {} };
    const { container } = renderWithCtx(<Field field={field} hostOccurrence={{ id: "occ-1" }} />, { operationsById: { x: listener("x", "fb1") } });
    const btn = container.querySelector("button");
    expect(btn.textContent).toMatch(/Show Profile/);
    expect(btn.disabled).toBe(false);
  });

  it("uses meta.buttonLabel when provided", () => {
    const field = { id: "fb2", type: "button", name: "Internal", meta: { buttonLabel: "Run Pomodoro" } };
    const { container } = renderWithCtx(<Field field={field} hostOccurrence={{ id: "occ-1" }} />);
    expect(container.querySelector("button").textContent).toMatch(/Run Pomodoro/);
  });

  it("with nothing listening it stays clickable, runs nothing and says why", () => {
    mockRun.mockClear();
    const field = { id: "fb3", type: "button", name: "Click", meta: {} };
    const { container } = renderWithCtx(<Field field={field} hostOccurrence={{ id: "occ-1" }} />, { operationsById: { y: listener("y", "other") } });
    const btn = container.querySelector("button");
    expect(btn.disabled).toBe(false);
    expect(btn.title).toMatch(/Nothing listens/);
    fireEvent.click(btn);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("respects the disabled prop", () => {
    const field = { id: "fb5", type: "button", name: "Click", meta: {} };
    const { container } = renderWithCtx(<Field field={field} hostOccurrence={{ id: "occ-1" }} disabled={true} />, { operationsById: { x: listener("x", "fb5") } });
    expect(container.querySelector("button").disabled).toBe(true);
  });

  it("a click runs EVERY listener with the pressed occurrence", () => {
    mockRun.mockClear();
    const field = { id: "fb6", type: "button", name: "Show", meta: {} };
    const ops = { a: listener("a", "fb6"), b: listener("b", "fb6"), c: listener("c", "other") };
    const { container } = renderWithCtx(<Field field={field} hostOccurrence={{ id: "occ-row-7", moduleId: "mod-row-7" }} />, { operationsById: ops });
    fireEvent.click(container.querySelector("button"));
    expect(mockRun).toHaveBeenCalledTimes(2);
    expect(mockRun.mock.calls.map((c) => c[0][0].id).sort()).toEqual(["a", "b"]);
    expect(mockRun.mock.calls[0][1]).toBe("ButtonOp");
    expect(mockRun.mock.calls[0][2]).toMatchObject({ type: "ButtonOp", occurrenceId: "occ-row-7", instanceId: "mod-row-7", fieldId: "fb6" });
  });

  it("dispatches computed-value updates for display-only effects", () => {
    mockRun.mockClear();
    mockRun.mockReturnValueOnce([{ fieldId: "ftxt", value: "Hello" }, { _effect: "SHOW_TOAST", message: "ignored" }]);
    const field = { id: "fb7", type: "button", name: "Run", meta: {} };
    const { ctx, container } = renderWithCtx(<Field field={field} hostOccurrence={{ id: "occ-1" }} />, { operationsById: { x: listener("x", "fb7") } });
    fireEvent.click(container.querySelector("button"));
    const action = ctx.dispatch.mock.calls[0][0];
    expect(action.type).toBe("SET_COMPUTED_VALUES");
    expect(action.updates).toEqual([{ fieldId: "ftxt", value: "Hello" }]);
  });
});
