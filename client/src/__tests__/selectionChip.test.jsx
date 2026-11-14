import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SelectionChip, { selectionChipText } from "../ui/SelectionChip.jsx";
import { SelectionContext, pressKeepsSelection } from "../state/SelectionContext";

describe("the selection chip", () => {
  it("says how many are selected, or what a staged paste will do", () => {
    expect(selectionChipText({ count: 0 })).toBe(null);
    expect(selectionChipText({ count: 3 })).toBe("3 selected · Esc to clear");
    expect(selectionChipText({ count: 3, clipboard: { mode: "move", ids: ["a", "b"] } })).toMatch(/move 2 here · Esc to cancel/);
  });
  it("clears from its button, and pressing it keeps the selection", () => {
    const clear = vi.fn();
    render(<SelectionContext.Provider value={{ count: 2, clear, clipboard: null }}><SelectionChip /></SelectionContext.Provider>);
    const btn = screen.getByLabelText("Clear the selection");
    expect(pressKeepsSelection({ target: btn, button: 0 }, () => false)).toBe(true);
    fireEvent.click(btn);
    expect(clear).toHaveBeenCalled();
  });
  it("renders nothing with nothing selected", () => {
    const { container } = render(<SelectionContext.Provider value={{ count: 0, clipboard: null }}><SelectionChip /></SelectionContext.Provider>);
    expect(container.innerHTML).toBe("");
  });
});
