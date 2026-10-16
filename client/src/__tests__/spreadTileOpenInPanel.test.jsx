// @vitest-environment jsdom
// A viewer tile's "Open in panel" (user, 2026-10-16: "open up the file in the panel (whether its
// image, video, etc)").
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const open = vi.fn(() => ({ ok: true }));
vi.mock("../hooks/useOpenArtifactInPanel", async (orig) => ({ ...(await orig()), useOpenArtifactInPanel: () => open }));
import SpreadTileOpenInPanel from "../ui/SpreadTileOpenInPanel";
import { SpreadHostContext } from "../helpers/spreadDock";
import { panelOccForModuleId } from "../hooks/useOpenArtifactInPanel";

const inViewer = (ui, host) => render(<SpreadHostContext.Provider value={host}>{ui}</SpreadHostContext.Provider>);
beforeEach(() => open.mockClear());

describe("SpreadTileOpenInPanel", () => {
  it("opens the file in the viewer's own panel, then closes the viewer", () => {
    const close = vi.fn();
    inViewer(<SpreadTileOpenInPanel occurrenceId="img1" isFile />, { originPanelModuleId: "pm", close });
    fireEvent.click(screen.getByRole("button", { name: "Open in panel" }));
    expect(open).toHaveBeenCalledWith("img1", { fromPanelModuleId: "pm" });
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("keeps the viewer open when the open fails", () => {
    open.mockReturnValueOnce({ ok: false });
    const close = vi.fn();
    inViewer(<SpreadTileOpenInPanel occurrenceId="img1" isFile />, { originPanelModuleId: null, close });
    fireEvent.click(screen.getByRole("button", { name: "Open in panel" }));
    expect(close).not.toHaveBeenCalled();
  });
  it("renders nothing outside the viewer, or for a tile that is not a file", () => {
    render(<SpreadTileOpenInPanel occurrenceId="img1" isFile />);
    expect(screen.queryByRole("button")).toBe(null);
    inViewer(<SpreadTileOpenInPanel occurrenceId="row1" isFile={false} />, { originPanelModuleId: "pm", close: () => {} });
    expect(screen.queryByRole("button")).toBe(null);
  });
});

describe("panelOccForModuleId", () => {
  const panels = { pA: { id: "pA", moduleId: "mA" }, pB: { id: "pB", moduleId: "mB" } };
  it("maps a panel MODULE id (data-panel-id) to its occurrence", () => {
    expect(panelOccForModuleId("mB", panels)).toBe("pB");
    expect(panelOccForModuleId("pA", panels)).toBe("pA");
    expect(panelOccForModuleId("nope", panels)).toBe(null);
    expect(panelOccForModuleId(null, panels)).toBe(null);
  });
});
