// The input-side clipboard menu.
//
// The RISK here is not the menu, it is the interception: it must open on a
// text input and, crucially, must NOT open anywhere else — every surface menu
// on this grid still needs its own right-click.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TextContextMenu from "../ui/TextContextMenu.jsx";

function rightClick(el) {
  fireEvent.contextMenu(el, { clientX: 10, clientY: 10, bubbles: true });
}

// A stand-in for the surface handlers (ModuleInstance, ModuleContainer, …):
// they listen in the BUBBLE phase on their own elements, so a capture-phase
// stopPropagation on document is what keeps them from firing.
function spyOnSurfaceHandler(el) {
  const fired = [];
  el.addEventListener("contextmenu", () => fired.push(1));
  return fired;
}

let host;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  delete navigator.clipboard;
});
// Remove only OUR node — wiping document.body takes React's own root and the
// portalled menu with it, and the unmount then throws NotFoundError.
afterEach(() => { host?.remove(); });

describe("opening on a text input", () => {
  it("opens our menu and suppresses the browser's", () => {
    render(<TextContextMenu />);
    const el = document.createElement("input");
    el.value = "hello world";
    host.appendChild(el);
    el.setSelectionRange(0, 5);

    // fireEvent returns FALSE when the event was cancelled. A raw
    // dispatchEvent is not wrapped in act(), so React never flushes and the
    // menu appears not to open — a fact about the test, not the code.
    const notCancelled = fireEvent.contextMenu(el, { clientX: 5, clientY: 5, bubbles: true, cancelable: true });

    expect(notCancelled).toBe(false);         // no native menu on top of ours
    expect(screen.getByText("Cut")).toBeTruthy();
    expect(screen.getByText("Copy")).toBeTruthy();
    expect(screen.getByText("Paste")).toBeTruthy();
  });

  // THE CONTROL. Without it "the menu opens on inputs" is also satisfied by a
  // listener that opens on absolutely everything and eats every surface menu.
  it("does NOT open on an ordinary element, and lets its handler run", () => {
    render(<TextContextMenu />);
    const div = document.createElement("div");
    host.appendChild(div);
    const surface = spyOnSurfaceHandler(div);

    rightClick(div);

    expect(screen.queryByText("Paste")).toBeNull();
    expect(surface).toHaveLength(1);          // the row's own menu still works
  });

  it("stops the surface handler when it DOES open", () => {
    render(<TextContextMenu />);
    const el = document.createElement("input");
    host.appendChild(el);
    const surface = spyOnSurfaceHandler(host);   // an ancestor, as a row would be

    rightClick(el);

    expect(screen.getByText("Paste")).toBeTruthy();
    expect(surface).toHaveLength(0);
  });

  it("offers Paste alone at a collapsed caret", () => {
    render(<TextContextMenu />);
    const el = document.createElement("input");
    el.value = "hello";
    host.appendChild(el);
    el.setSelectionRange(2, 2);

    rightClick(el);

    expect(screen.getByText("Paste")).toBeTruthy();
    expect(screen.queryByText("Cut")).toBeNull();
    expect(screen.queryByText("Copy")).toBeNull();
  });
});

describe("acting on the field the menu was opened on", () => {
  it("copies the selection", async () => {
    render(<TextContextMenu />);
    const el = document.createElement("input");
    el.value = "hello world";
    host.appendChild(el);
    el.setSelectionRange(6, 11);
    let written = null;
    navigator.clipboard = { writeText: async (t) => { written = t; } };

    rightClick(el);
    fireEvent.click(screen.getByText("Copy"));

    await waitFor(() => expect(written).toBe("world"));
  });

  // Focus moves to the menu on click, so the action cannot re-derive the field
  // from document.activeElement — it has to be the one the menu was opened on.
  it("pastes into the ORIGINAL field even after focus moved away", async () => {
    render(<TextContextMenu />);
    const el = document.createElement("input");
    el.value = "hello ";
    host.appendChild(el);
    el.setSelectionRange(6, 6);
    const other = document.createElement("input");
    host.appendChild(other);
    navigator.clipboard = { readText: async () => "there" };

    rightClick(el);
    other.focus();                       // focus is elsewhere by click time
    fireEvent.click(screen.getByText("Paste"));

    await waitFor(() => expect(el.value).toBe("hello there"));
    expect(other.value).toBe("");
  });

  it("closes after acting", async () => {
    render(<TextContextMenu />);
    const el = document.createElement("input");
    el.value = "x";
    host.appendChild(el);
    navigator.clipboard = { readText: async () => "y" };

    rightClick(el);
    fireEvent.click(screen.getByText("Paste"));

    await waitFor(() => expect(screen.queryByText("Paste")).toBeNull());
  });
});
