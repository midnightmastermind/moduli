/**
 * toolbarUndo.test.jsx
 *
 * Undo had existed since the undo/redo rebuild and could only be reached with
 * Ctrl+Z — so on a tablet, the surface the user is most often on, it could not
 * be reached at all (user 2026-08-26: *"put a back undo button in next to the
 * command center"*).
 *
 * These pin the two things that make the button honest: it is DISABLED rather
 * than hidden when there is nothing to undo (so it does not move under the
 * thumb), and it actually calls what it was given.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Toolbar from "../Toolbar.jsx";

const base = {
  gridId: "g1", availableGrids: [], grid: { _id: "g1", name: "g" }, fieldsById: {},
  onGridChange: () => {}, onCreateNewGrid: () => {}, onCommandCenter: () => {},
  onHistory: () => {}, onLogout: () => {}, userId: "u1", userEmail: "a@b.c",
};

describe("Toolbar undo button", () => {
  it("is present next to the command center", () => {
    render(<Toolbar {...base} onUndo={() => {}} canUndo />);
    expect(screen.getByTitle("Undo (Ctrl+Z)")).toBeTruthy();
    expect(screen.getByTitle(/command center/i)).toBeTruthy();
  });

  it("calls onUndo when there is something to undo", () => {
    const onUndo = vi.fn();
    render(<Toolbar {...base} onUndo={onUndo} canUndo />);
    fireEvent.click(screen.getByTitle("Undo (Ctrl+Z)"));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  // Disabled, NOT hidden — a control that appears and disappears moves every
  // button beside it, which on a touch surface means mis-taps.
  it("stays in place and disabled when there is nothing to undo", () => {
    const onUndo = vi.fn();
    render(<Toolbar {...base} onUndo={onUndo} canUndo={false} />);
    const btn = screen.getByTitle("Nothing to undo");
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("refuses while an undo is already in flight", () => {
    const onUndo = vi.fn();
    render(<Toolbar {...base} onUndo={onUndo} canUndo undoBusy />);
    const btn = screen.getByTitle("Undo (Ctrl+Z)");
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onUndo).not.toHaveBeenCalled();
  });

  // The whole point: it is not gated behind the desktop-only block.
  it("is offered on a mobile layout, where there is no Ctrl+Z", () => {
    render(<Toolbar {...base} onUndo={() => {}} canUndo isMobileLayout />);
    expect(screen.getByTitle("Undo (Ctrl+Z)")).toBeTruthy();
  });
});

// Reload sits beside it. The states it exists for are the ones where the TAB is
// the stale thing — a stale `occurrences[]` echoed back, a pre-deploy bundle —
// so it is a real reload rather than a re-sync, and it is never disabled: there
// is no such thing as "nothing to reload".
describe("Toolbar reload button", () => {
  it("sits between undo and the command center", () => {
    const { container } = render(<Toolbar {...base} onUndo={() => {}} canUndo onReload={() => {}} />);
    const order = [...container.querySelectorAll("button")].map(b => b.getAttribute("title"));
    const u = order.indexOf("Undo (Ctrl+Z)");
    const r = order.indexOf("Reload");
    const c = order.findIndex(t => t && /command center/i.test(t));
    expect(u).toBeGreaterThanOrEqual(0);
    expect(r).toBe(u + 1);
    expect(c).toBe(r + 1);
  });

  it("calls onReload", () => {
    const onReload = vi.fn();
    render(<Toolbar {...base} onReload={onReload} />);
    fireEvent.click(screen.getByTitle("Reload"));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("is never disabled — there is no 'nothing to reload'", () => {
    render(<Toolbar {...base} onReload={() => {}} />);
    expect(screen.getByTitle("Reload").disabled).toBe(false);
  });

  it("is offered on a mobile layout too", () => {
    render(<Toolbar {...base} onReload={() => {}} isMobileLayout />);
    expect(screen.getByTitle("Reload")).toBeTruthy();
  });
});
