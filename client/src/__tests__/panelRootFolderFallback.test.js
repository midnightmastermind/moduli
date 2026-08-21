// A panel is never a dead "No content" shell — including after its LAST page
// is closed.
//
// USER, 2026-08-21: *"an empty panel just goes to the root manifest folder in
// folder view in the panel"*.
//
// That default already existed for a panel being CREATED — both the Toolbar "+"
// and the empty-cell tap call `openPanelOnRootFolderPage` — and stopped at the
// panel's first moment. A panel that became empty LATER fell through to the
// "No content" fallback in `ModulePanel`.
//
// It matters one level up too: the merged sidebar OMITS its "Pinned" section
// when a panel has nothing pinned, on the stated grounds that such a panel
// "already shows the root manifest folder as its CONTENT". That was true only
// for new panels, so an emptied one showed neither the section nor the content.
//
// These tests cover the HELPER's contract. The `existingView` branch is the part
// that makes the third caller safe: a created panel has no view and needs one, a
// re-opened panel already has one and minting a second would strand the first.
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { openPanelOnRootFolderPage } from "../helpers/importsFolder";

vi.mock("../helpers/CommitHelpers", () => ({
  createFolder: vi.fn(), updateFolder: vi.fn(), createPage: vi.fn(),
  createModule: vi.fn(), createOccurrence: vi.fn(), createView: vi.fn(),
  updateView: vi.fn(), updateOccurrence: vi.fn(),
}));

const grid = { _id: "grid-1", manifestId: "mfst-1" };
const manifestsById = { "mfst-1": { id: "mfst-1", rootFolderId: "root-1", name: "Root" } };
// The root folder page already exists, so these tests measure the VIEW branch
// rather than the mint-a-page branch.
const occurrencesById = {
  "fp-1": { id: "fp-1", parentId: "root-1", meta: { folderPage: true } },
};
const modulesById = {};
const base = { grid, gridId: "grid-1", manifestsById, occurrencesById, modulesById,
               dispatch: vi.fn(), socket: {}, userId: "u1" };

beforeEach(() => vi.clearAllMocks());

describe("openPanelOnRootFolderPage", () => {
  it("points the panel at the root folder page", () => {
    const id = openPanelOnRootFolderPage({ ...base, panelOccId: "panel-1" });
    expect(id).toBe("fp-1");
    const occ = CommitHelpers.updateOccurrence.mock.calls[0][0].occurrence;
    expect(occ.id).toBe("panel-1");
    expect(occ.occurrences).toEqual(["fp-1"]);
  });

  it("MINTS a view for a panel that has none — the created-panel case", () => {
    openPanelOnRootFolderPage({ ...base, panelOccId: "panel-1" });
    expect(CommitHelpers.createView).toHaveBeenCalledTimes(1);
    expect(CommitHelpers.updateView).not.toHaveBeenCalled();
    const view = CommitHelpers.createView.mock.calls[0][0].view;
    expect(view).toMatchObject({ viewType: "board", activeOccurrenceId: "fp-1" });
  });

  // THE DISCRIMINATING CASE. Without it every emptied panel strands a View.
  it("REUSES the panel's existing view — the emptied-panel case", () => {
    const existingView = { id: "view-9", userId: "u1", gridId: "grid-1",
                           viewType: "markdown", activeOccurrenceId: "gone", hasTree: true };
    openPanelOnRootFolderPage({ ...base, panelOccId: "panel-1", existingView });
    expect(CommitHelpers.createView).not.toHaveBeenCalled();
    expect(CommitHelpers.updateView).toHaveBeenCalledTimes(1);
    const view = CommitHelpers.updateView.mock.calls[0][0].view;
    expect(view.id).toBe("view-9");
    expect(view).toMatchObject({ viewType: "board", activeOccurrenceId: "fp-1" });
    // Keys the caller did not name survive — the view is re-pointed, not rebuilt.
    expect(view.hasTree).toBe(true);
  });

  it("wires the panel to the SAME view id it reused", () => {
    const existingView = { id: "view-9" };
    openPanelOnRootFolderPage({ ...base, panelOccId: "panel-1", existingView });
    expect(CommitHelpers.updateOccurrence.mock.calls[0][0].occurrence.viewId).toBe("view-9");
  });

  it("fails closed when the manifest has not loaded — writes nothing", () => {
    const id = openPanelOnRootFolderPage({ ...base, panelOccId: "panel-1", manifestsById: {} });
    expect(id).toBeNull();
    expect(CommitHelpers.createView).not.toHaveBeenCalled();
    expect(CommitHelpers.updateView).not.toHaveBeenCalled();
    expect(CommitHelpers.updateOccurrence).not.toHaveBeenCalled();
  });
});
