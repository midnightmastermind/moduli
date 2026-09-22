// A MENU'S CLICKS STAY IN THE MENU.
//
// React bubbles synthetic events through the REACT tree, not the DOM — so a
// menu portalled into <body> still delivers its clicks to whatever component
// rendered it. `PreviewNode` renders its <ContextMenu> inside the card whose
// onClick opens that card's page, so EVERY item in a folder card's right-click
// menu — "New board page", even "Delete" — also opened the card (found
// rebuilding poms grid through the UI, 2026-09-22; stack mapped to
// PreviewNode.jsx:333 onDrillDown). Fixed once, in the surface every floating
// menu renders through.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import ContextMenu from "../ui/ContextMenu";

function Host({ onHostClick, onHostPointerDown, onItem }) {
  return (
    <div onClick={onHostClick} onPointerDown={onHostPointerDown} data-testid="host">
      card
      <ContextMenu ctx={{ x: 10, y: 10, items: [{ label: "New board page", onClick: onItem }] }} onClose={() => {}} />
    </div>
  );
}

describe("MenuSurface contains its events", () => {
  it("an item click runs the item and does NOT reach the host that rendered the menu", () => {
    const onHostClick = vi.fn(); const onItem = vi.fn();
    render(<Host onHostClick={onHostClick} onHostPointerDown={() => {}} onItem={onItem} />);
    fireEvent.click(screen.getByText("New board page"));
    expect(onItem).toHaveBeenCalledTimes(1);
    expect(onHostClick).not.toHaveBeenCalled();
  });

  it("a press inside the menu does not start the host's pointer gesture", () => {
    const onHostPointerDown = vi.fn();
    render(<Host onHostClick={() => {}} onHostPointerDown={onHostPointerDown} onItem={() => {}} />);
    fireEvent.pointerDown(screen.getByText("New board page"));
    expect(onHostPointerDown).not.toHaveBeenCalled();
  });

  it("CONTROL — the host still hears its own clicks", () => {
    const onHostClick = vi.fn();
    render(<Host onHostClick={onHostClick} onHostPointerDown={() => {}} onItem={() => {}} />);
    fireEvent.click(screen.getByTestId("host"));
    expect(onHostClick).toHaveBeenCalledTimes(1);
  });
});
