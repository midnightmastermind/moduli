// Regression (2026-07-12): a stored multi-value array must render its values.
// FieldRenderer unwraps {value, flow} and passes the BARE array to Field;
// Field's extractValue used to treat an array as "object without a value key"
// → undefined → every multi-select rendered "—" on load (tags feed E2E find).
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

const tagsField = {
  id: "f-tags", name: "Tags", type: "select", inputEnabled: true,
  meta: {
    multiSelect: true,
    _resolvedOptions: [
      { value: "journal", label: "journal" },
      { value: "idea", label: "idea" },
    ],
  },
};

describe("Field — stored array values render (multi-select)", () => {
  it("compact select multi shows the stored tag, not the empty dash", () => {
    renderWithCtx(
      <Field field={tagsField} binding={{ fieldId: "f-tags", role: "input" }}
        value={["journal"]} compact onCommit={vi.fn()} />
    );
    expect(screen.getByText("journal")).toBeTruthy();
    expect(screen.queryByText("—")).toBeNull();
  });

  it("joins multiple stored tags", () => {
    renderWithCtx(
      <Field field={tagsField} binding={{ fieldId: "f-tags", role: "input" }}
        value={["journal", "idea"]} compact onCommit={vi.fn()} />
    );
    expect(screen.getByText("journal, idea")).toBeTruthy();
  });
});
