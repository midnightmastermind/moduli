// On a phone the toolbar's date nav moves INTO the Filters button (user,
// 2026-09-24) — it must move, not vanish: a phone once had no way to change
// the date at all (2026-08-05). Desktop keeps it inline.
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Toolbar from "../Toolbar.jsx";
import { GridActionsContext } from "../GridActionsContext";

const grid = {
  _id: "g1", name: "g", activeFilterId: "f1",
  namedFilters: [{ id: "f1", name: "Date", conditions: [{ fieldId: "d1", isNav: true, comparator: "SAME_DAY" }] }],
  activeFilterValues: { d1: "2026-09-24" },
};
const base = {
  gridId: "g1", availableGrids: [], grid, fieldsById: { d1: { id: "d1", name: "Date", type: "date" } },
  onGridChange: () => {}, onCreateNewGrid: () => {}, onCommandCenter: () => {},
  onHistory: () => {}, onLogout: () => {}, userId: "u1", userEmail: "a@b.c", onUndo: () => {},
};

const ctx = {
  socket: { connected: true, emit: () => {}, on: () => {}, off: () => {} }, dispatch: () => {},
  state: { grid }, fieldsById: base.fieldsById, occurrencesById: {}, modulesById: {}, foldersById: {},
};
const mount = (props) => render(<GridActionsContext.Provider value={ctx}><Toolbar {...base} {...props} /></GridActionsContext.Provider>);

describe("toolbar date nav", () => {
  it("desktop: inline on the toolbar", () => {
    mount();
    expect(screen.getAllByTitle("Prev").length).toBe(1);
  });

  it("mobile: not on the toolbar, but inside the Filters popover", () => {
    const { container } = mount({ isMobileLayout: true });
    expect(screen.queryAllByTitle("Prev")).toHaveLength(0);
    const trigger = [...container.querySelectorAll("button")].find(b => /filter/i.test(b.title || b.getAttribute("aria-label") || ""));
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.getByTestId("toolbar-filter-date")).toBeTruthy();
    expect(screen.getAllByTitle("Prev").length).toBe(1);
  });
});
