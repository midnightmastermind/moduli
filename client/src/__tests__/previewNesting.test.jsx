// A card drawn inside another card's preview must not mount a live preview of
// its own: for a folder inside a folder that recursed all the way down and
// froze the app (user, 2026-10-20).
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

const slot = vi.fn((_i, cb) => { cb(); return () => {}; });
vi.mock("../PagePreviewApp.jsx", () => ({ PagePreviewBody: () => <div data-testid="page-body" /> }));
vi.mock("../GridActionsContext.js", () => ({ useGridActions: () => ({ dispatch: vi.fn(), socket: null }) }));
vi.mock("../helpers/previewAdmission.js", () => ({ requestPreviewSlot: (...a) => slot(...a) }));
globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };
globalThis.IntersectionObserver ??= class {
  constructor(cb) { this.cb = cb; }
  observe() { this.cb([{ isIntersecting: true }]); }
  disconnect() {}
};
import PreviewNode from "../modules/PreviewNode.jsx";
import { PreviewNestingContext } from "../helpers/previewNesting.js";

const folder = { id: "f", role: "page", kind: "folder", label: "Music" };
const occ = { id: "fo", moduleId: "f", meta: {} };

describe("PreviewNode inside a preview", () => {
  it("shows its icon, mounts no preview body and takes no admission slot", () => {
    slot.mockClear();
    const { queryByTestId, container } = render(
      <PreviewNestingContext.Provider value={true}>
        <PreviewNode occurrence={occ} module={folder} onDrillDown={() => {}} />
      </PreviewNestingContext.Provider>
    );
    expect(queryByTestId("page-body")).toBeNull();
    expect(container.querySelector(".preview-node-nested-face")).toBeTruthy();
    expect(slot).not.toHaveBeenCalled();
  });

  it("control: a top-level card still mounts its preview", () => {
    slot.mockClear();
    const { getByTestId } = render(<PreviewNode occurrence={occ} module={folder} onDrillDown={() => {}} />);
    expect(getByTestId("page-body")).toBeTruthy();
    expect(slot).toHaveBeenCalled();
  });
});
