// ui/ArtifactSpread — the overlay SHELL.
//
// It owns the backdrop, the chrome, Escape, the board⇄canvas switch and the
// shift-to-leave ghosting. It owns NO arrangement: the tiles are laid out by
// the app's existing board/canvas renderers, mounted as children by the host.
// So these tests assert the shell's contract and that it renders whatever it
// is handed — never that it positions anything.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import ArtifactSpread, { SPREAD_CLOSE_MS } from "../ui/ArtifactSpread";

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

  // THESE TWO CHANGED CONTRACT ON 2026-08-17 and are updated rather than
  // deleted. The close is no longer reported synchronously: the surface stays
  // mounted to play the inverse of its open animation and reports afterwards
  // (user: "the zoom in effect thats the opposite of when opening it").
  // The "not yet" assertion is the one that matters — it is what fails if the
  // gate is ever removed and the surface goes back to vanishing instantly.
  it("closes on Escape AFTER the exit animation, not during it", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    renderSpread({ onClose });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(SPREAD_CLOSE_MS); });
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  // UI sweep 53: Escape in the bookmark address bar restored the address AND
  // shut the viewer. A control that already used the key marks it handled.
  it("stays open when a control inside already handled Escape", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <ArtifactSpread open title="t" mode="board" count={1} onClose={onClose} onAdd={vi.fn()} onModeChange={vi.fn()}>
        <input data-testid="addr" onKeyDown={(e) => { if (e.key === "Escape") e.preventDefault(); }} />
      </ArtifactSpread>
    );
    fireEvent.keyDown(screen.getByTestId("addr"), { key: "Escape" });
    act(() => { vi.advanceTimersByTime(SPREAD_CLOSE_MS); });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector(".artifact-spread--closing")).toBeNull();
    // control: the same key with nothing handling it still closes
    fireEvent.keyDown(document, { key: "Escape" });
    act(() => { vi.advanceTimersByTime(SPREAD_CLOSE_MS); });
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("closes on a backdrop click but NOT on a click inside the surface", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    renderSpread({ onClose });
    fireEvent.click(document.querySelector(".artifact-spread"));
    act(() => { vi.advanceTimersByTime(SPREAD_CLOSE_MS); });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector(".artifact-spread-backdrop"));
    expect(onClose).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(SPREAD_CLOSE_MS); });
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("wears the closing class while it animates out", () => {
    vi.useFakeTimers();
    renderSpread({ onClose: vi.fn() });
    expect(document.querySelector(".artifact-spread--closing")).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    // Still mounted — this is what gives the keyframes a frame to run in.
    expect(document.querySelector(".artifact-spread--closing")).not.toBeNull();
    expect(document.querySelector(".artifact-spread-backdrop--closing")).not.toBeNull();
    act(() => { vi.advanceTimersByTime(SPREAD_CLOSE_MS); });
    vi.useRealTimers();
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

  // 2026-10-22: the viewer covers the whole screen, and "armed" only faded it — so a tile dragged
  // out was still over the viewer and could never reach the doc or board beneath. Once a Shift-drag
  // starts, the shell (and its backdrop) stop catching the pointer.
  it("a Shift-drag that starts lets the pointer through to the grid beneath", () => {
    renderSpread({ onClose: vi.fn() });
    fireEvent.keyDown(document, { key: "Shift" });
    expect(document.querySelector(".artifact-spread--leaving")).toBe(null);
    fireEvent.dragStart(document.querySelector(".artifact-spread"));
    expect(document.querySelector(".artifact-spread--leaving")).toBeTruthy();
    expect(document.querySelector(".artifact-spread-backdrop--leaving")).toBeTruthy();
  });

  it("an unshifted drag keeps the viewer catching the pointer (it reorders inside)", () => {
    renderSpread({ onClose: vi.fn() });
    fireEvent.dragStart(document.querySelector(".artifact-spread"));
    expect(document.querySelector(".artifact-spread--leaving")).toBe(null);
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
