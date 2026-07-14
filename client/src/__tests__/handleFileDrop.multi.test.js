// __tests__/handleFileDrop.multi.test.js
// Locks down the multi-file drop orchestration:
//  - one placeholder module + occurrence dispatched per file
//  - one batched container-occurrences update (not N updates)
//  - one /api/artifacts/upload POST per file
// Catches regressions where the loop gets reduced back to files[0].
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleFileDrop } from "../helpers/dropHandlers";
import * as CommitHelpers from "../helpers/CommitHelpers";
import * as LayoutHelpers from "../helpers/LayoutHelpers";
import * as UploadHelpers from "../helpers/uploadWithProgress";

function makeFile(name, type = "image/png", size = 1024) {
  // Minimal File-shape that mimics the bits handleFileDrop reads.
  return { name, type, size };
}

function makeCtx({ files, containerDestination = true }) {
  const modules = {
    panelMod: { id: "panelMod", role: "panel", kind: "board" },
    containerMod: { id: "containerMod", role: "container", kind: "board" },
  };
  const occs = {
    panelOcc: { id: "panelOcc", moduleId: "panelMod", occurrences: ["containerOcc"] },
    containerOcc: { id: "containerOcc", moduleId: "containerMod", occurrences: ["existingChild"] },
  };
  const dropContext = {
    payload: { data: { files } },
    target: containerDestination
      ? { occurrenceId: "containerOcc", moduleId: "containerMod" }
      : { occurrenceId: null, moduleId: null },
    pointer: { x: 0, y: 0 },
    position: { edge: null, insertIndex: -1 },
  };
  const ctx = {
    dispatch: vi.fn(),
    socket: { emit: vi.fn() },
    state: { gridId: "g1", userId: "u1", grid: { _id: "g1" }, modulesById: modules, viewsById: {} },
    occurrencesById: occs,
    baseContainers: [modules.containerMod],
    clearSession: vi.fn(),
    getCellFromPoint: () => ({ row: 0, col: 0 }),
  };
  return { dropContext, ctx };
}

describe("handleFileDrop — multi-file orchestration", () => {
  let uploadSpy, updateOccSpy, updateModSpy;

  beforeEach(() => {
    // Each upload resolves to a server-shape upload response. Spy on the new
    // XHR helper instead of fetch — handleFileDrop switched to
    // uploadFileWithProgress in audit gap #7.
    uploadSpy = vi.spyOn(UploadHelpers, "uploadFileWithProgress").mockImplementation(({ formData }) => {
      const moduleId = formData?.get?.("moduleId") || "mod";
      return Promise.resolve({
        module: { id: moduleId, label: "ok", meta: { uploadStatus: "ready" } },
      });
    });
    updateOccSpy = vi.spyOn(CommitHelpers, "updateOccurrence").mockImplementation(() => {});
    updateModSpy = vi.spyOn(CommitHelpers, "updateModule").mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("dispatches one placeholder module + occurrence per file, then one batched container update", () => {
    const files = [makeFile("a.png"), makeFile("b.jpg"), makeFile("c.gif")];
    const { dropContext, ctx } = makeCtx({ files });

    handleFileDrop(dropContext, ctx);

    // dispatches: createModule * 3 + createOccurrence * 3 = 6
    expect(ctx.dispatch).toHaveBeenCalledTimes(6);

    // Container occurrences[] should be updated exactly once with all 3 new ids appended.
    expect(updateOccSpy).toHaveBeenCalledTimes(1);
    const call = updateOccSpy.mock.calls[0][0];
    expect(call.occurrence.id).toBe("containerOcc");
    expect(call.occurrence.occurrences.length).toBe(4); // 1 existing + 3 new
    expect(call.occurrence.occurrences[0]).toBe("existingChild");

    // One upload call per file, all pointed at the canonical endpoint.
    expect(uploadSpy).toHaveBeenCalledTimes(3);
    for (const c of uploadSpy.mock.calls) {
      expect(c[0].url).toBe("/api/artifacts/upload");
    }
  });

  it("single-file drop preserves the original single-update behavior", () => {
    const files = [makeFile("solo.png")];
    const { dropContext, ctx } = makeCtx({ files });

    handleFileDrop(dropContext, ctx);

    // 2 dispatches (module + occurrence), 1 container update, 1 upload.
    expect(ctx.dispatch).toHaveBeenCalledTimes(2);
    expect(updateOccSpy).toHaveBeenCalledTimes(1);
    expect(uploadSpy).toHaveBeenCalledTimes(1);
  });

  it("dropped on a board page-gap lands in the page's first column, not a new panel", () => {
    // No container hovered — only a pageOccurrenceId in the drop target's raw
    // context (the native drop resolved a board page but no column). The file
    // must land in the page's first container, NOT mint a standalone artifact
    // panel ("side view of the file").
    const modules = {
      pageMod: { id: "pageMod", role: "page", kind: "board" },
      colMod: { id: "colMod", role: "container", kind: "board" },
    };
    const occs = {
      pageOcc: { id: "pageOcc", moduleId: "pageMod", occurrences: ["colOcc"] },
      colOcc: { id: "colOcc", moduleId: "colMod", occurrences: ["existingChild"] },
    };
    const dropContext = {
      payload: { data: { files: [makeFile("vid.mp4", "video/mp4")] } },
      target: { occurrenceId: null, moduleId: null, raw: { pageOccurrenceId: "pageOcc" } },
      pointer: { x: 0, y: 0 },
      position: { edge: null, insertIndex: null },
    };
    const createViewSpy = vi.spyOn(CommitHelpers, "createView").mockImplementation(() => {});
    const ctx = {
      dispatch: vi.fn(),
      socket: { emit: vi.fn() },
      state: { gridId: "g1", userId: "u1", grid: { _id: "g1" }, modulesById: modules, viewsById: {} },
      occurrencesById: occs,
      baseContainers: [modules.colMod],
      clearSession: vi.fn(),
      getCellFromPoint: () => ({ row: 0, col: 0 }),
    };

    handleFileDrop(dropContext, ctx);

    // The artifact occurrence is appended to the page's column — one update, to
    // colOcc, with the new id after the existing child.
    expect(updateOccSpy).toHaveBeenCalledTimes(1);
    const call = updateOccSpy.mock.calls[0][0];
    expect(call.occurrence.id).toBe("colOcc");
    expect(call.occurrence.occurrences.length).toBe(2);
    expect(call.occurrence.occurrences[0]).toBe("existingChild");
    // No standalone artifact panel/view was minted (the old "side view" bug).
    expect(createViewSpy).not.toHaveBeenCalled();
  });

  it("dropped on a canvas page becomes a free-positioned child (no side-view panel)", () => {
    const modules = { canvasMod: { id: "canvasMod", role: "page", kind: "canvas" } };
    const occs = { canvasOcc: { id: "canvasOcc", moduleId: "canvasMod", occurrences: [] } };
    const dropContext = {
      payload: { data: { files: [makeFile("pic.png")] } },
      target: { occurrenceId: null, moduleId: null, raw: { pageOccurrenceId: "canvasOcc" } },
      pointer: { x: 40, y: 40 },
      position: { edge: null, insertIndex: null },
    };
    const createViewSpy = vi.spyOn(CommitHelpers, "createView").mockImplementation(() => {});
    const ctx = {
      dispatch: vi.fn(), socket: { emit: vi.fn() },
      state: { gridId: "g1", userId: "u1", grid: { _id: "g1" }, modulesById: modules, viewsById: {} },
      occurrencesById: occs, baseContainers: [], clearSession: vi.fn(),
      getCellFromPoint: () => ({ row: 0, col: 0 }),
    };

    handleFileDrop(dropContext, ctx);

    // The artifact occurrence is appended to the CANVAS PAGE (a free child).
    expect(updateOccSpy).toHaveBeenCalled();
    const call = updateOccSpy.mock.calls[0][0];
    expect(call.occurrence.id).toBe("canvasOcc");
    expect(call.occurrence.occurrences.length).toBe(1);
    // No display-viewer "side view" panel/view minted.
    expect(createViewSpy).not.toHaveBeenCalled();
  });

  it("dropped on an EMPTY grid cell drills down to a board panel+container (never a display panel)", () => {
    const panelOcc = { id: "newPanelOcc", occurrences: [] };
    const contOcc = { id: "newContOcc", occurrences: [] };
    const panelSpy = vi.spyOn(LayoutHelpers, "createPanelInGrid").mockReturnValue({ occurrence: panelOcc });
    const contSpy = vi.spyOn(LayoutHelpers, "createContainerInPanel").mockReturnValue({ occurrence: contOcc });
    const createViewSpy = vi.spyOn(CommitHelpers, "createView").mockImplementation(() => {});

    const dropContext = {
      payload: { data: { files: [makeFile("clip.mp4", "video/mp4")] } },
      target: { occurrenceId: null, moduleId: null, raw: {} }, // no container, no page
      pointer: { x: 5, y: 5 },
      position: { edge: null, insertIndex: null },
    };
    const ctx = {
      dispatch: vi.fn(), socket: { emit: vi.fn() },
      state: { gridId: "g1", userId: "u1", grid: { _id: "g1" }, modulesById: {}, viewsById: {} },
      occurrencesById: {}, baseContainers: [], clearSession: vi.fn(),
      getCellFromPoint: () => ({ row: 1, col: 2 }),
    };

    handleFileDrop(dropContext, ctx);

    // Drill-down: a board panel + container were minted at the cell...
    expect(panelSpy).toHaveBeenCalled();
    expect(contSpy).toHaveBeenCalled();
    // ...and the artifact was appended to the NEW container.
    const appendCall = updateOccSpy.mock.calls.find(c => c[0].occurrence.id === "newContOcc");
    expect(appendCall).toBeTruthy();
    expect(appendCall[0].occurrence.occurrences.length).toBe(1);
    // The old "open a side view of the file" panel/view is gone for good.
    expect(createViewSpy).not.toHaveBeenCalled();
  });

  it("empty file list short-circuits without dispatch or upload", () => {
    const { dropContext, ctx } = makeCtx({ files: [] });
    handleFileDrop(dropContext, ctx);

    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(updateOccSpy).not.toHaveBeenCalled();
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(ctx.clearSession).toHaveBeenCalled();
  });
});
