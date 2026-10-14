// The Grid tab's "Mosaic" button builds a split layout from the panels'
// placements (2026-10-14). It read state.occurrencesById, which the app's state
// does not have (occurrences are a list), so it found no panels and saved no
// layout: the button never worked from the UI.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";

const updateGrid = vi.fn();
vi.mock("../helpers/CommitHelpers", async (orig) => ({ ...(await orig()), updateGrid: (...a) => updateGrid(...a) }));
const panels = [
  { id: "pA", moduleId: "mA", placement: { row: 0, col: 0, width: 1, height: 1 } },
  { id: "pB", moduleId: "mB", placement: { row: 0, col: 1, width: 1, height: 1 } },
  { id: "pC", moduleId: "mC", placement: { row: 1, col: 0, width: 1, height: 1 } },
  { id: "pD", moduleId: "mD", placement: { row: 1, col: 1, width: 1, height: 1 } },
];
const grid = { _id: "g1", name: "G", rows: 2, cols: 2, occurrences: panels.map((p) => p.id), meta: {} };
const ctx = {
  state: { grid, gridId: "g1", occurrences: panels, modules: [] },
  occurrencesById: Object.fromEntries(panels.map((p) => [p.id, p])),
  modulesById: Object.fromEntries(panels.map((p) => [p.moduleId, { id: p.moduleId, role: "panel", layout: {} }])),
  fieldsById: {}, foldersById: {}, dispatch: vi.fn(), socket: null,
};
vi.mock("../GridActionsContext.js", () => ({
  useGridActions: () => ctx,
  useGridActionsSelector: (sel) => sel(ctx),
  useGridActionsSelectorShallow: (sel) => sel(ctx),
  GridActionsContext: { Provider: ({ children }) => children },
}));
import { GridSettingsTab } from "../ui/commandCenter/GridSettingsTab";

describe("Grid settings › Mosaic", () => {
  it("saves a split layout holding every panel", () => {
    render(<GridSettingsTab />);
    fireEvent.click(screen.getByTitle("Free split panes (resize both axes)"));
    expect(updateGrid).toHaveBeenCalled();
    const tree = updateGrid.mock.calls.at(-1)[0].grid.meta.layoutTree;
    expect(tree).toBeTruthy();
    const leaves = []; const walk = (t) => (t.panelOccId ? leaves.push(t.panelOccId) : t.children.forEach(walk)); walk(tree);
    expect(leaves.sort()).toEqual(["pA", "pB", "pC", "pD"]);
  });
});
