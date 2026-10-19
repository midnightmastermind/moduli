/**
 * The account menu's "User settings" opened the Command Center through the toolbar's TOGGLE, so it
 * closed an open Command Center and otherwise showed whatever tab was last used (UI sweep item 62,
 * 2026-10-19). It calls onUserSettings now, which App wires to the Settings tab.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import Toolbar from "../Toolbar.jsx";
import { GridActionsContext } from "../GridActionsContext";

const base = {
  gridId: "g1", availableGrids: [], fieldsById: {}, grid: { _id: "g1", name: "g", meta: {} },
  onGridChange: () => {}, onCreateNewGrid: () => {}, onHistory: () => {}, onLogout: () => {},
  userId: "u1", userEmail: "a@b.c", onUndo: () => {}, canUndo: false,
};
const renderWith = (extra) => render(
  <GridActionsContext.Provider value={{ addNewPanel: () => {} }}>
    <Toolbar {...base} {...extra} />
  </GridActionsContext.Provider>
);

describe("account menu › User settings", () => {
  it("desktop: opens Settings, never toggles the Command Center", async () => {
    const toggle = vi.fn(); const settings = vi.fn();
    renderWith({ onCommandCenter: toggle, onUserSettings: settings });
    await act(async () => { fireEvent.click(screen.getByTitle("Account")); });
    fireEvent.click(await screen.findByText("User settings"));
    expect(settings).toHaveBeenCalledTimes(1);
    expect(toggle).not.toHaveBeenCalled();
  });
  it("phone menu: the same", () => {
    const toggle = vi.fn(); const settings = vi.fn();
    renderWith({ onCommandCenter: toggle, onUserSettings: settings, isMobileLayout: true });
    fireEvent.click(screen.getByTitle("Open menu"));
    fireEvent.click(screen.getByText("User Settings"));
    expect(settings).toHaveBeenCalledTimes(1);
    expect(toggle).not.toHaveBeenCalled();
  });
});
