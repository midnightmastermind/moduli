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

// Regression (2026-07-14): array-history DISPLAY fields ("Workouts" / "Meals"
// rows with displayConfig.columns). Two bugs compounded to a permanent "—":
// (1) rawDisplayValue treated the bare array FieldRenderer hands over as
// "object without a value key" → undefined (extractValue got the same fix
// 2026-07-12; the display memo was missed); (2) the compact pill branch
// returned before the columnar-table branch, so a compact tile could never
// render the rows at all.
const historyField = {
  id: "f-hist", name: "Workouts", type: "text",
  inputEnabled: false, displayEnabled: true, meta: {},
  displayConfig: {
    columns: [
      { path: "label", header: "Exercise" },
      { path: "reps", header: "Reps" },
      { path: "weight", header: "Wt" },
    ],
  },
};
const rows = [{ label: "Bench Press", reps: 12, weight: 135 }];

describe("Field — array-history display fields render their rows", () => {
  it("NON-compact renders the columnar table from the bare array", () => {
    renderWithCtx(
      <Field field={historyField} binding={{ fieldId: "f-hist", role: "display" }}
        value={rows} />
    );
    expect(screen.getByText("Bench Press")).toBeTruthy();
    expect(screen.getByText("Exercise")).toBeTruthy();
    expect(screen.queryByText("—")).toBeNull();
  });

  it("COMPACT (goal tile) renders the columnar table too", () => {
    renderWithCtx(
      <Field field={historyField} binding={{ fieldId: "f-hist", role: "display" }}
        value={rows} compact />
    );
    expect(screen.getByText("Bench Press")).toBeTruthy();
    expect(screen.getByText("135")).toBeTruthy();
    expect(screen.queryByText("—")).toBeNull();
  });

  it("an EMPTY history renders the dash pill, not a bare table", () => {
    renderWithCtx(
      <Field field={historyField} binding={{ fieldId: "f-hist", role: "display" }}
        value={[]} compact />
    );
    expect(screen.getByText("—")).toBeTruthy();
  });
});
