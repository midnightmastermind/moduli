// Regression (2026-07-12): the transient +N/−N flow-delta badge must be
// absolutely positioned. An in-flow badge widened the pill on every goal
// update, wrapping tightly-packed goal rows to the next line for 1.5s
// (user: "the plus/minus indicator pushes the stuff to the right").
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext";
import Field from "../ui/Field";

function renderWithCtx(node) {
  const ctx = {
    dispatch: vi.fn(), socket: null, gridId: "g1", userId: "u1",
    occurrencesById: {}, modulesById: {}, fieldsById: {}, operationsById: {},
    state: { grid: {} },
  };
  return render(
    <GridActionsContext.Provider value={ctx}>{node}</GridActionsContext.Provider>
  );
}

const numField = {
  id: "f-num", name: "Tasks Completed", type: "number",
  displayEnabled: true, meta: {},
};
const binding = { fieldId: "f-num", role: "display" };

function findBadge(container) {
  return Array.from(container.querySelectorAll("span"))
    .find((el) => /^[+-]\d/.test(el.textContent.trim()));
}

describe("Field — flow-delta badge stays out of flow", () => {
  it("compact pill: badge appears on value change and is position:absolute", () => {
    const { container, rerender } = renderWithCtx(
      <Field field={numField} binding={binding} value={3} compact />
    );
    expect(findBadge(container)).toBeUndefined();
    rerender(
      <GridActionsContext.Provider value={{
        dispatch: vi.fn(), socket: null, gridId: "g1", userId: "u1",
        occurrencesById: {}, modulesById: {}, fieldsById: {}, operationsById: {},
        state: { grid: {} },
      }}>
        <Field field={numField} binding={binding} value={5} compact />
      </GridActionsContext.Provider>
    );
    const badge = findBadge(container);
    expect(badge).toBeTruthy();
    expect(badge.textContent.trim()).toBe("+2");
    expect(badge.style.position).toBe("absolute");
    const pill = badge.closest(".field-display-compact");
    expect(pill.style.position).toBe("relative");
  });

  it("non-compact box: badge is position:absolute inside a relative box", () => {
    const { container, rerender } = renderWithCtx(
      <Field field={numField} binding={binding} value={10} />
    );
    rerender(
      <GridActionsContext.Provider value={{
        dispatch: vi.fn(), socket: null, gridId: "g1", userId: "u1",
        occurrencesById: {}, modulesById: {}, fieldsById: {}, operationsById: {},
        state: { grid: {} },
      }}>
        <Field field={numField} binding={binding} value={9} />
      </GridActionsContext.Provider>
    );
    const badge = findBadge(container);
    expect(badge).toBeTruthy();
    expect(badge.textContent.trim()).toBe("-1");
    expect(badge.style.position).toBe("absolute");
    expect(badge.parentElement.style.position).toBe("relative");
  });
});
