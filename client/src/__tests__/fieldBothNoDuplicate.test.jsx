// A field with BOTH input and display on drew two pills with the same name: the display half shows
// `computed ?? inputValue`, so with nothing computed it repeated the input's own value. On every grid
// that shape is one field — Daily Question — and no operation computes it, so the row read
// "Daily Question: -" over "Daily Question: —" (found by the 2026-11-04 UI sweep).
// The display half is drawn only when something has computed a value for this row.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext";
import FieldRenderer from "../ui/FieldRenderer";
import { publishComputedValues } from "../state/computedValuesStore";

const field = { id: "f-both", type: "number", name: "Water", inputEnabled: true, displayEnabled: true };
const occ = { id: "o1", moduleId: "m1", fields: { "f-both": { value: 3 } } };

function mount() {
  const occs = { o1: occ };
  const mods = { m1: { id: "m1", role: "instance", label: "Row" } };
  const ctx = {
    dispatch: vi.fn(), socket: { emit: vi.fn() }, gridId: "g1", userId: "u1",
    occurrencesById: occs, modulesById: mods, fieldsById: { [field.id]: field },
    foldersById: {}, operationsById: {}, state: { grid: {}, occurrences: Object.values(occs) },
    getOccMap: () => occs, getModMap: () => mods,
  };
  return render(
    <GridActionsContext.Provider value={ctx}>
      <FieldRenderer field={field} occurrence={occ} compact />
    </GridActionsContext.Provider>
  );
}
const names = (c) => [...c.querySelectorAll(".field-pill-name")].map((e) => e.textContent.trim());

afterEach(() => act(() => publishComputedValues({})));

describe("input + display field", () => {
  it("with nothing computed, the field shows once", () => {
    const { container } = mount();
    expect(names(container).filter((n) => n.startsWith("Water"))).toHaveLength(1);
  });

  it("with a computed value, the display half shows it beside the input — the control", () => {
    act(() => publishComputedValues({ "f-both:o1": 9 }));
    const { container } = mount();
    expect(names(container).filter((n) => n.startsWith("Water"))).toHaveLength(2);
    expect(container.textContent).toContain("9");
  });
});
