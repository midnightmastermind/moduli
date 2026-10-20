// A doc container filed straight into a folder (the Wikipedia importer's shape) is a card on the
// folder page; clicking it did nothing because canDrillDown excluded containers (UI sweep 2026-10-19).
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("../PagePreviewApp.jsx", () => ({ PagePreviewBody: () => <div data-testid="page-body" /> }));
vi.mock("../GridActionsContext.js", () => ({ useGridActions: () => ({ dispatch: vi.fn(), socket: null }) }));
vi.mock("../helpers/previewAdmission.js", () => ({ requestPreviewSlot: (_i, cb) => { cb(); return () => {}; } }));
globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };
import PreviewNode from "../modules/PreviewNode.jsx";

const occ = { id: "o1", moduleId: "m1", meta: {} };
const card = (kind) => ({ id: "m1", role: "container", kind, label: "Noam Chomsky", meta: {} });
const clickCard = (container) => fireEvent.click(container.querySelector(".preview-node-card"));

describe("PreviewNode — container cards on a folder page", () => {
  it("a doc container card opens", () => {
    const onDrillDown = vi.fn();
    const { container } = render(<PreviewNode occurrence={occ} module={card("doc")} onDrillDown={onDrillDown} />);
    clickCard(container);
    expect(onDrillDown).toHaveBeenCalledWith("o1", expect.anything());
  });
  it("a container of a kind no page can show does not", () => {
    const onDrillDown = vi.fn();
    const { container } = render(<PreviewNode occurrence={occ} module={card("graph")} onDrillDown={onDrillDown} />);
    clickCard(container);
    expect(onDrillDown).not.toHaveBeenCalled();
  });
});
