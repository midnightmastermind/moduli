// A COMPACT PILL FOR A "SEVERAL PICKS" SELECT WRITES A LIST.
//
// Found rebuilding poms grid through the UI (2026-09-22): tagging a row
// "meal" through its Board Category pill stored the STRING "meal", while
// every one of poms grid's 400 stored values for that field is an ARRAY. The
// compact select branch ignored `meta.multiSelect` — it could DISPLAY an
// array but only ever wrote one value, and a second pick replaced the first.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext";
import Field from "../ui/Field";

function renderWithCtx(node) {
  const ctx = {
    dispatch: vi.fn(), socket: null, gridId: "g1", userId: "u1",
    occurrencesById: {}, modulesById: {}, fieldsById: {}, operationsById: {},
    state: { grid: {} },
  };
  return render(<GridActionsContext.Provider value={ctx}>{node}</GridActionsContext.Provider>);
}

const field = (multiSelect) => ({
  id: "f-cat", name: "Board Category", type: "select", inputEnabled: true,
  meta: { multiSelect, _resolvedOptions: [{ value: "meal", label: "meal" }, { value: "ingredient", label: "ingredient" }] },
});

async function pick(label) {
  const opt = (await screen.findAllByText(label)).at(-1);
  fireEvent.click(opt);
}

describe("compact select pill", () => {
  it("a multi-pick field commits an ARRAY, and a second pick adds to it", async () => {
    const onCommit = vi.fn();
    const { rerender } = renderWithCtx(<Field field={field(true)} binding={{ fieldId: "f-cat", role: "input" }} value={null} compact onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("combobox"));
    await pick("meal");
    expect(onCommit).toHaveBeenLastCalledWith(["meal"]);
    rerender(<GridActionsContext.Provider value={{ dispatch: vi.fn(), socket: null, occurrencesById: {}, modulesById: {}, fieldsById: {}, operationsById: {}, state: { grid: {} } }}>
      <Field field={field(true)} binding={{ fieldId: "f-cat", role: "input" }} value={["meal"]} compact onCommit={onCommit} />
    </GridActionsContext.Provider>);
    if (!screen.queryAllByText("ingredient").length) fireEvent.click(screen.getByRole("combobox"));
    await pick("ingredient");
    expect(onCommit).toHaveBeenLastCalledWith(["meal", "ingredient"]);
  });

  it("CONTROL — a single-pick field still commits one value", async () => {
    const onCommit = vi.fn();
    renderWithCtx(<Field field={field(false)} binding={{ fieldId: "f-cat", role: "input" }} value={null} compact onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button", { name: /Board Category/i }));
    await pick("meal");
    expect(onCommit).toHaveBeenLastCalledWith("meal");
  });
});
