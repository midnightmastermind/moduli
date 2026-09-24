// Folder-page cards for FILES (Files/Images): the card shows the file itself
// and a click opens it. Before: the face was a scaled render of the artifact
// page (a dark box) and `canDrillDown` excluded artifacts, so clicks did nothing.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("../PagePreviewApp.jsx", () => ({ PagePreviewBody: () => <div data-testid="page-body" /> }));
vi.mock("../GridActionsContext.js", () => ({ useGridActions: () => ({ dispatch: vi.fn(), socket: null }) }));
vi.mock("../helpers/previewAdmission.js", () => ({ requestPreviewSlot: (_i, cb) => { cb(); return () => {}; } }));
globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };
import PreviewNode from "../modules/PreviewNode.jsx";

const img = { id: "m1", role: "artifact", kind: "image", label: "cat.png", fileRef: "gdrive:c1:F9", meta: {} };
const occ = { id: "o1", moduleId: "m1", meta: {} };

describe("PreviewNode — artifact cards", () => {
  it("shows the image itself, not a page preview", () => {
    const { container, queryByTestId } = render(<PreviewNode occurrence={occ} module={img} onDrillDown={() => {}} />);
    const el = container.querySelector(".preview-node-artifact img");
    expect(el?.getAttribute("src")).toBe("/files/c1/F9");
    expect(queryByTestId("page-body")).toBeNull();
  });

  it("prefers the generated thumbnail over the original", () => {
    const withThumb = { ...img, fileRef: "user/2026-09/cat.png", meta: { thumb1024: "thumbnails/abc-1024.webp" } };
    const { container } = render(<PreviewNode occurrence={occ} module={withThumb} onDrillDown={() => {}} />);
    expect(container.querySelector(".preview-node-artifact img").getAttribute("src")).toBe("/uploads/thumbnails/abc-1024.webp");
  });

  it("a click opens it", () => {
    const onDrillDown = vi.fn();
    const { container } = render(<PreviewNode occurrence={occ} module={img} onDrillDown={onDrillDown} />);
    fireEvent.click(container.querySelector(".preview-node-card"));
    expect(onDrillDown).toHaveBeenCalledWith("o1", expect.anything());
  });

  it("control: a page card still gets the page preview", () => {
    const page = { id: "p", role: "page", kind: "board", label: "Tasks" };
    const { container } = render(<PreviewNode occurrence={{ id: "po", moduleId: "p", meta: {} }} module={page} onDrillDown={() => {}} />);
    expect(container.querySelector(".preview-node-artifact")).toBeNull();
  });
});
