// A display field may name what its EMPTY state MEANS.
//
// `Tracker Date` reads "Total" when no date filter is set, because an empty
// period on a tracker means "aggregate everything" — `periodAllPolicy`'s rule —
// not "no data". A dash there is actively misleading: the tile is showing an
// all-time number while its own label implies it has none.
//
// Generic on purpose. The renderer reads `field.meta.emptyLabel` and learns
// nothing about trackers; which field carries it is DATA (migration 0167).
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
  return render(<GridActionsContext.Provider value={ctx}>{node}</GridActionsContext.Provider>);
}

const dateField = (meta = {}) => ({
  id: "f-td", name: "Tracker Date", type: "date", displayEnabled: true, inputEnabled: false, meta,
});

describe("a display field can name its empty state", () => {
  it("renders the label instead of a dash when there is no value", () => {
    renderWithCtx(<Field field={dateField({ emptyLabel: "Total" })} value={null} />);
    expect(screen.getByText("Total")).toBeTruthy();
  });

  it("CONTROL — the same field without the flag still reads as a dash", () => {
    // Without this the test above proves nothing: "Total" could be coming from
    // anywhere, and a renderer that ignored the value entirely would pass.
    const { container } = renderWithCtx(<Field field={dateField()} value={null} />);
    expect(container.textContent).toContain("—");
    expect(container.textContent).not.toContain("Total");
  });

  it("a REAL value still wins — the label is for empty only", () => {
    const { container } = renderWithCtx(
      <Field field={dateField({ emptyLabel: "Total" })} value="2026-08-21" />);
    expect(container.textContent).not.toContain("Total");
    expect(container.textContent).toMatch(/Aug/);
  });

  it("an empty NUMBER field says its label rather than 0", () => {
    // The numeric default returns "0" before the dash, so the label has to be
    // checked first or a labelled number field would silently read zero.
    const f = { id: "f-n", name: "Count", type: "number", displayEnabled: true, meta: { emptyLabel: "Total" } };
    const { container } = renderWithCtx(<Field field={f} value={null} />);
    expect(container.textContent).toContain("Total");
    expect(container.textContent).not.toMatch(/\b0\b/);
  });
});
