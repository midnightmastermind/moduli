// __tests__/spreadDock.test.jsx
// The dock decision, and the ONE rule everything else rests on:
// **every unknown falls back to full screen** — which is exactly the behaviour
// that already worked. A feature whose failure mode is the previous behaviour
// cannot make anything worse than it was.
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  dockVars, panelIdForElement, panelRect, readDockPreference, writeDockPreference,
} from "../helpers/spreadDock";
import ArtifactSpread from "../ui/ArtifactSpread";

const RECT = { top: 100, left: 200, width: 640, height: 480 };

describe("dockVars — the fallback rule", () => {
  it("emits the four positioning properties when docked with a rect", () => {
    expect(dockVars({ docked: true, rect: RECT })).toEqual({
      "--dock-top": "100px", "--dock-left": "200px",
      "--dock-width": "640px", "--dock-height": "480px",
    });
  });

  // Each of these is a real state: the switch is off; the viewer was opened
  // from somewhere that is not in a panel; the panel unmounted or was
  // translated to zero size by the mobile cell slider.
  it("returns null when docking is off", () => {
    expect(dockVars({ docked: false, rect: RECT })).toBe(null);
  });
  it("returns null when no rect could be resolved", () => {
    expect(dockVars({ docked: true, rect: null })).toBe(null);
  });
});

describe("panelIdForElement — derived, never passed", () => {
  it("walks up to the nearest panel", () => {
    const panel = document.createElement("div");
    panel.setAttribute("data-panel-id", "panel-7");
    const inner = document.createElement("span");
    panel.appendChild(inner);
    expect(panelIdForElement(inner)).toBe("panel-7");
  });

  // A doc embed, a preview iframe, a bare card in a harness. Null is what makes
  // the switch hide rather than render inert.
  it("returns null outside any panel", () => {
    expect(panelIdForElement(document.createElement("div"))).toBe(null);
    expect(panelIdForElement(null)).toBe(null);
  });
});

describe("panelRect — a zero-area panel is not a place to dock", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("reads the panel's box", () => {
    const el = document.createElement("div");
    el.setAttribute("data-panel-id", "p1");
    el.getBoundingClientRect = () => ({ ...RECT });
    document.body.appendChild(el);
    expect(panelRect("p1")).toEqual(RECT);
  });

  // A panel translated off screen by the mobile cell slider still HAS a box.
  // Docking a video into a 0x0 hole is indistinguishable from the viewer having
  // vanished, so it must read as "no panel" and fall back to full screen.
  it("reads a collapsed panel as no panel at all", () => {
    const el = document.createElement("div");
    el.setAttribute("data-panel-id", "p2");
    el.getBoundingClientRect = () => ({ top: 0, left: 0, width: 0, height: 0 });
    document.body.appendChild(el);
    expect(panelRect("p2")).toBe(null);
  });

  it("returns null for a panel that is gone", () => {
    expect(panelRect("nope")).toBe(null);
  });
});

describe("the preference survives a storage that refuses to work", () => {
  it("round-trips", () => {
    writeDockPreference(true);
    expect(readDockPreference()).toBe(true);
    writeDockPreference(false);
    expect(readDockPreference()).toBe(false);
  });

  // A private window, or a browser set to block site data. The session still
  // has to work — it just does not remember.
  it("reads false rather than throwing when storage is unavailable", () => {
    const spy = vi.spyOn(window.localStorage, "getItem")
      .mockImplementation(() => { throw new Error("denied"); });
    expect(readDockPreference()).toBe(false);
    expect(() => writeDockPreference(true)).not.toThrow();
    spy.mockRestore();
  });
});

describe("ArtifactSpread — the switch", () => {
  const base = { open: true, title: "Movie", count: 1, children: <div /> };

  it("is hidden when the viewer was not opened from inside a panel", () => {
    render(<ArtifactSpread {...base} canDock={false} />);
    expect(screen.queryByLabelText(/inside the panel|Fill the screen/)).toBeNull();
  });

  it("offers docking when a panel is available", () => {
    render(<ArtifactSpread {...base} canDock dockRect={RECT} onDockChange={() => {}} />);
    expect(screen.getByLabelText("Open inside the panel")).toBeTruthy();
  });

  it("reports the flip to the host, which is what persists it", () => {
    const onDockChange = vi.fn();
    render(<ArtifactSpread {...base} canDock dockRect={RECT} onDockChange={onDockChange} />);
    fireEvent.click(screen.getByLabelText("Open inside the panel"));
    expect(onDockChange).toHaveBeenCalledWith(true);
  });

  it("positions itself at the panel and drops the full-screen backdrop", () => {
    render(<ArtifactSpread {...base} canDock docked dockRect={RECT} onDockChange={() => {}} />);
    // Portalled to document.body — the render container never contains it.
    const surface = document.querySelector(".artifact-spread");
    expect(surface.className).toContain("artifact-spread--docked");
    expect(surface.style.getPropertyValue("--dock-width")).toBe("640px");
    // NO BACKDROP is the point of docking, not an omission: the whole reason to
    // dock is to keep using the rest of the grid, and a full-screen backdrop
    // would swallow every click outside the panel.
    expect(document.querySelector(".artifact-spread-backdrop")).toBeNull();
  });

  // The load-bearing case. Docking ON with no usable panel box must not produce
  // a surface positioned at nowhere — it must be the full-screen viewer.
  it("stays full screen when docking is on but no panel box is known", () => {
    render(<ArtifactSpread {...base} canDock docked dockRect={null} onDockChange={() => {}} />);
    const surface = document.querySelector(".artifact-spread");
    expect(surface.className).not.toContain("artifact-spread--docked");
    expect(document.querySelector(".artifact-spread-backdrop")).toBeTruthy();
  });
});
