// The radial menu audit (user, 2026-09-26): like-minded items share a submenu,
// nothing cycles, and the menu does not close on its own.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import RadialMenu, { groupItems } from "../ui/RadialMenu";

describe("groupItems", () => {
  it("gathers a group into one submenu where its first member was", () => {
    const out = groupItems([
      { label: "Settings" },
      { label: "Copy name", group: "Copy" },
      { label: "Remove" },
      { label: "Copy link", group: "Copy" },
    ]);
    expect(out.map((i) => i.label)).toEqual(["Settings", "Copy", "Remove"]);
    expect(out[1].submenu.map((i) => i.label)).toEqual(["Copy name", "Copy link"]);
  });

  it("joins an existing submenu of the same name (To pill → the container's Convert)", () => {
    const out = groupItems([
      { label: "Convert", submenu: [{ label: "Doc" }, { label: "Table" }] },
      { label: "To pill", group: "Convert" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].submenu.map((i) => i.label)).toEqual(["Doc", "Table", "To pill"]);
  });

  it("a group of one stays a plain button", () => {
    const out = groupItems([{ label: "Wrap behind previous", group: "Wrap", onClick: () => {} }]);
    expect(out).toEqual([{ label: "Wrap behind previous", onClick: expect.any(Function) }]);
  });
});

describe("RadialMenu stays open", () => {
  it("does not close itself after a while", () => {
    vi.useFakeTimers();
    render(<RadialMenu items={[{ label: "A", onClick: () => {} }]} />);
    fireEvent.click(screen.getByTestId("radial-handle"));
    act(() => { vi.advanceTimersByTime(20000); });
    expect(screen.getByTitle("A")).toBeTruthy();
    vi.useRealTimers();
  });

  it("a press on an item does not reach the menu's React parents", () => {
    const parentDown = vi.fn(); const parentClick = vi.fn();
    render(<div onPointerDown={parentDown} onClick={parentClick}><RadialMenu items={[{ label: "A", onClick: () => {} }, { label: "B", onClick: () => {} }]} /></div>);
    fireEvent.click(screen.getByTestId("radial-handle"));
    parentClick.mockClear();
    const a = screen.getByTitle("A");
    fireEvent.pointerDown(a); fireEvent.click(a);
    expect(parentDown).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("marks the current choice in a submenu", () => {
    render(<RadialMenu items={[{ label: "Position", submenu: [{ label: "Left", onClick: () => {} }, { label: "Right", active: true, onClick: () => {} }] }]} />);
    fireEvent.click(screen.getByTestId("radial-handle"));
    fireEvent.click(screen.getByTitle("Position ›"));
    expect(screen.getByTitle("Right (current)").getAttribute("aria-pressed")).toBe("true");
  });
});
