// ONE VIEWER TILE FILLS THE VIEWER.
//
// User, 2026-09-11: *"We need a button to expand the occurance in the viewer.
// put it on the headers of the occurances in the viewer ... its a grid but we
// can make individual ones full screen."*
//
// The shell (`ArtifactSpread`) owns WHICH tile is maximized; each tile's header
// (`SpreadTileMaximize`) toggles it. These tests drive the real shell with
// stand-in tiles, so they cover the seam — the contract between the two — not
// just the button on its own.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import ArtifactSpread, { SPREAD_CLOSE_MS } from "../ui/ArtifactSpread";
import SpreadTileMaximize, { useIsSpreadMaximized } from "../ui/SpreadTileMaximize";

afterEach(() => { cleanup(); vi.useRealTimers(); });

// A tile the way ModuleInstance renders one: the header button, plus a marker
// that says whether it is the maximized one.
function Tile({ id }) {
  const on = useIsSpreadMaximized(id);
  return (
    <div data-testid={`tile-${id}`} data-maximized={on ? "1" : "0"}>
      <SpreadTileMaximize occurrenceId={id} />
    </div>
  );
}

function renderShell(props = {}) {
  return render(
    <ArtifactSpread open title="Two files" mode="board" count={2} onClose={vi.fn()} {...props}>
      <Tile id="a" />
      <Tile id="b" />
    </ArtifactSpread>
  );
}

const btn = (id) => document.querySelector(`[data-testid="tile-${id}"] .spread-tile-maximize`);
const state = (id) => document.querySelector(`[data-testid="tile-${id}"]`).dataset.maximized;

describe("filling the viewer with one tile", () => {
  // THE CONTROL. Without it, "a tile gets a button" is equally satisfied by
  // putting the button on every row of every board — ~1,000 of them.
  it("renders NOTHING outside the viewer", () => {
    const { container } = render(<Tile id="a" />);
    expect(container.querySelector(".spread-tile-maximize")).toBeNull();
  });

  it("a header click maximizes that tile, and a second click puts it back", () => {
    renderShell();
    expect(state("a")).toBe("0");
    fireEvent.click(btn("a"));
    expect(state("a")).toBe("1");
    expect(btn("a").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btn("a"));
    expect(state("a")).toBe("0");
  });

  it("only one tile fills the viewer at a time", () => {
    renderShell();
    fireEvent.click(btn("a"));
    fireEvent.click(btn("b"));
    expect(state("a")).toBe("0");
    expect(state("b")).toBe("1");
  });

  // Escape used to mean one thing here: close the viewer. With a tile
  // maximized it means "back to the grid" first — closing would throw away
  // every file you had open to answer a request to see the others.
  it("Escape restores the grid BEFORE it closes the viewer", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    renderShell({ onClose });
    fireEvent.click(btn("a"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(state("a"), "Escape did not restore the grid").toBe("0");
    act(() => { vi.advanceTimersByTime(SPREAD_CLOSE_MS); });
    expect(onClose, "it closed the viewer too").not.toHaveBeenCalled();
    // ...and the next Escape closes, as it always did.
    fireEvent.keyDown(document, { key: "Escape" });
    act(() => { vi.advanceTimersByTime(SPREAD_CLOSE_MS); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // The canvas arrangement free-positions its tiles; there is no grid for one
  // to step out of, so the control would be present and inert.
  it("offers nothing in the canvas arrangement", () => {
    renderShell({ mode: "canvas" });
    expect(btn("a")).toBeNull();
  });

  it("switching to the canvas drops a maximize", () => {
    const { rerender } = renderShell();
    fireEvent.click(btn("a"));
    const again = (mode) => (
      <ArtifactSpread open title="Two files" mode={mode} count={2} onClose={vi.fn()}>
        <Tile id="a" />
        <Tile id="b" />
      </ArtifactSpread>
    );
    rerender(again("canvas"));
    rerender(again("board"));
    expect(state("a")).toBe("0");
  });
});
