// The panel header's Home button and the grid's own header buttons (glossary page, 2026-11-15).
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PanelHeaderButtons, { panelButtonsFor } from "../ui/PanelHeaderButtons";

const ops = { op1: { id: "op1", name: "Panel: Open Glossary" } };

describe("panelButtonsFor", () => {
  it("lists the grid's buttons whose operation exists", () => {
    const grid = { meta: { panelButtons: [{ id: "b1", label: "Glossary", icon: "BookOpen", operationId: "op1" }, { id: "b2", label: "Gone", operationId: "missing" }] } };
    expect(panelButtonsFor(grid, ops).map((b) => b.id)).toEqual(["b1"]);
  });
  it("is empty for a grid with none", () => {
    expect(panelButtonsFor({ meta: {} }, ops)).toEqual([]);
    expect(panelButtonsFor(null, ops)).toEqual([]);
  });
});

describe("PanelHeaderButtons", () => {
  it("Home opens the root folder", () => {
    const onHome = vi.fn();
    render(<PanelHeaderButtons grid={{ meta: {} }} operationsById={ops} onHome={onHome} onRun={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(onHome).toHaveBeenCalled();
  });
  it("a grid button runs its operation", () => {
    const onRun = vi.fn();
    const grid = { meta: { panelButtons: [{ id: "b1", label: "Glossary", icon: "BookOpen", operationId: "op1" }] } };
    render(<PanelHeaderButtons grid={grid} operationsById={ops} onHome={() => {}} onRun={onRun} />);
    fireEvent.click(screen.getByRole("button", { name: "Glossary" }));
    expect(onRun).toHaveBeenCalledWith(ops.op1);
  });
});
