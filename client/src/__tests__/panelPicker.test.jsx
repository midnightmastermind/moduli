// The phone toolbar's one panel button (user, 2026-11-02): it opens a dropdown of the cells the phone pages
// through, each box named by the page its panel shows; a tap moves to that cell.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import PanelPicker, { panelBoxLabel, cellContains } from "../mobile/PanelPicker.jsx";
import { GridActionsContext } from "../GridActionsContext";
import { publishPhoneShape, getActiveCell, initActiveCellForGrid } from "../state/activeCellStore";

const occs = {
  pA: { id: "pA", moduleId: "mA", viewId: "vA" },
  pB: { id: "pB", moduleId: "mB", viewId: "vB" },
  pgA: { id: "pgA", moduleId: "mpgA" },
  pgB: { id: "pgB", moduleId: "mpgB", label: "Tasks" },
};
const mods = { mA: { id: "mA", label: "Panel A" }, mB: { id: "mB", label: "Panel B" }, mpgA: { id: "mpgA", label: "Routines" }, mpgB: { id: "mpgB", label: "Ignored" } };
const views = { vA: { id: "vA", activeOccurrenceId: "pgA" }, vB: { id: "vB", activeOccurrenceId: "pgB" } };
const ctx = { getOccMap: () => occs, getModMap: () => mods, getViewMap: () => views };

describe("panel picker", () => {
  beforeEach(() => { initActiveCellForGrid("t", 3, 2); });

  it("names a box by the page its panel shows (occurrence label wins over the module)", () => {
    expect(panelBoxLabel({ occId: "pA", moduleId: "mA" }, { occurrencesById: occs, modulesById: mods, viewsById: views })).toBe("Routines");
    expect(panelBoxLabel({ occId: "pB", moduleId: "mB" }, { occurrencesById: occs, modulesById: mods, viewsById: views })).toBe("Tasks");
    expect(panelBoxLabel({ occId: "x", moduleId: "mA" }, { modulesById: mods })).toBe("Panel A");
  });

  it("a tall panel contains every cell it spans", () => {
    const c = { row: 0, col: 1, width: 1, height: 3 };
    expect(cellContains(c, 2, 1)).toBe(true);
    expect(cellContains(c, 2, 0)).toBe(false);
  });

  it("opens the boxes and a tap moves to that cell", () => {
    act(() => publishPhoneShape({ rows: 3, cols: 2, cells: [
      { row: 0, col: 0, width: 1, height: 1, occId: "pA", moduleId: "mA" },
      { row: 0, col: 1, width: 1, height: 3, occId: "pB", moduleId: "mB" },
    ] }));
    render(<GridActionsContext.Provider value={ctx}><PanelPicker /></GridActionsContext.Provider>);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByLabelText("Switch panel"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByText("Tasks"));
    expect(getActiveCell()).toEqual({ row: 0, col: 1 });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
