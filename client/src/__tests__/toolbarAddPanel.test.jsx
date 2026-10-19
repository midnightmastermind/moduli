/**
 * toolbarAddPanel.test.jsx
 *
 * A MOSAIC grid fills every pane, so there is no empty cell to tap and the
 * toolbar is where a new panel comes from (user 2026-10-19: "currently there is
 * no way to add new panel"). A rows×cols grid keeps its empty cells and gets no
 * button. GridMosaic splits a pane for any panel its tree lacks.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Toolbar from "../Toolbar.jsx";
import { GridActionsContext } from "../GridActionsContext";

const base = {
  gridId: "g1", availableGrids: [], fieldsById: {},
  onGridChange: () => {}, onCreateNewGrid: () => {}, onCommandCenter: () => {},
  onHistory: () => {}, onLogout: () => {}, userId: "u1", userEmail: "a@b.c",
  onUndo: () => {}, canUndo: false,
};
const mosaic = { _id: "g1", name: "g", meta: { layoutTree: { id: "l", panelOccId: "p1" } } };
const cells = { _id: "g1", name: "g", meta: {} };

function renderWith(grid, addNewPanel, extra = {}) {
  return render(
    <GridActionsContext.Provider value={{ addNewPanel }}>
      <Toolbar {...base} grid={grid} {...extra} />
    </GridActionsContext.Provider>
  );
}

describe("Toolbar Add panel", () => {
  it("adds a panel on a mosaic grid", () => {
    const add = vi.fn();
    renderWith(mosaic, add);
    fireEvent.click(screen.getByTitle("Add panel"));
    expect(add).toHaveBeenCalledWith("board");
  });

  it("is not offered on a rows×cols grid, which has empty cells", () => {
    renderWith(cells, vi.fn());
    expect(screen.queryByTitle("Add panel")).toBeNull();
  });

  it("is in the phone menu too", () => {
    const add = vi.fn();
    renderWith(mosaic, add, { isMobileLayout: true });
    fireEvent.click(screen.getByTitle("Open menu"));
    fireEvent.click(screen.getByText("Add panel"));
    expect(add).toHaveBeenCalledWith("board");
  });
});
