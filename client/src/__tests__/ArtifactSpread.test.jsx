// ui/ArtifactSpread — the overlay SHELL.
//
// It owns the backdrop, the chrome, Escape, the board⇄canvas switch and the
// shift-to-leave ghosting. It owns NO arrangement: the tiles are laid out by
// the app's existing board/canvas renderers, mounted as children by the host.
// So these tests assert the shell's contract and that it renders whatever it
// is handed — never that it positions anything.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ArtifactSpread from "../ui/ArtifactSpread";

afterEach(() => { cleanup(); delete document.body.dataset.layout; });

function renderSpread(props = {}) {
  return render(
    <ArtifactSpread
      open
      title="Ada Lovelace"
      mode="board"
      count={2}
      onClose={vi.fn()}
      onAdd={vi.fn()}
      onModeChange={vi.fn()}
      {...props}
    >
      <div data-testid="renderer">board renderer</div>
    </ArtifactSpread>
  );
}

describe("ArtifactSpread shell", () => {
  it("mounts the renderer it is handed rather than laying anything out itself", () => {
    renderSpread();
    expect(screen.getByTestId("renderer")).toBeTruthy();
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("2 files")).toBeTruthy();
  });

  it("renders nothing when closed", () => {
    renderSpread({ open: false });
    expect(document.querySelector(".artifact-spread")).toBe(null);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    renderSpread({ onClose });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a backdrop click but NOT on a click inside the surface", () => {
    const onClose = vi.fn();
    renderSpread({ onClose });
    fireEvent.click(document.querySelector(".artifact-spread"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector(".artifact-spread-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("toggles board → canvas and back", () => {
    const onModeChange = vi.fn();
    const { rerender } = renderSpread({ onModeChange });
    fireEvent.click(document.querySelector(".artifact-spread-mode"));
    expect(onModeChange).toHaveBeenCalledWith("canvas");

    rerender(
      <ArtifactSpread open title="x" mode="canvas" count={1} onModeChange={onModeChange}>
        <div />
      </ArtifactSpread>
    );
    fireEvent.click(document.querySelector(".artifact-spread-mode"));
    expect(onModeChange).toHaveBeenLastCalledWith("board");
  });

  it("carries the mode as a class so the stylesheet can size each arrangement", () => {
    renderSpread({ mode: "canvas" });
    expect(document.querySelector(".artifact-spread--canvas")).toBeTruthy();
  });

  it("routes the add button to onAdd — the ONE way to attach", () => {
    const onAdd = vi.fn();
    renderSpread({ onAdd });
    fireEvent.click(document.querySelector(".artifact-spread-add"));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("ghosts itself while Shift is held, so a drag can leave for the grid", () => {
    renderSpread();
    expect(document.querySelector(".artifact-spread--armed")).toBe(null);
    fireEvent.keyDown(document, { key: "Shift" });
    expect(document.querySelector(".artifact-spread--armed")).toBeTruthy();
    fireEvent.keyUp(document, { key: "Shift" });
    expect(document.querySelector(".artifact-spread--armed")).toBe(null);
  });

  it("disarms when the window loses focus mid-gesture", () => {
    renderSpread();
    fireEvent.keyDown(document, { key: "Shift" });
    expect(document.querySelector(".artifact-spread--armed")).toBeTruthy();
    fireEvent.blur(window);
    expect(document.querySelector(".artifact-spread--armed")).toBe(null);
  });

  it("closes once a Shift-armed drag ends — the tile has left the overlay", () => {
    const onClose = vi.fn();
    renderSpread({ onClose });
    fireEvent.keyDown(document, { key: "Shift" });
    fireEvent.dragStart(document.querySelector(".artifact-spread"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.dragEnd(document);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT hijack an unshifted drag — that one is the renderer's to arrange", () => {
    const onClose = vi.fn();
    renderSpread({ onClose });
    fireEvent.dragStart(document.querySelector(".artifact-spread"));
    fireEvent.dragEnd(document);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("drops the mode switch on mobile, where the spread is one full-screen column", () => {
    document.body.dataset.layout = "mobile";
    renderSpread();
    expect(document.querySelector(".artifact-spread--mobile")).toBeTruthy();
    expect(document.querySelector(".artifact-spread-mode")).toBe(null);
  });
});
