// __tests__/handleFileDrop.multi.test.js
// Locks down the multi-file drop orchestration:
//  - one placeholder module + occurrence dispatched per file
//  - one batched container-occurrences update (not N updates)
//  - one /api/artifacts/upload POST per file
// Catches regressions where the loop gets reduced back to files[0].
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleFileDrop } from "../helpers/dropHandlers";
import * as CommitHelpers from "../helpers/CommitHelpers";
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

  it("empty file list short-circuits without dispatch or upload", () => {
    const { dropContext, ctx } = makeCtx({ files: [] });
    handleFileDrop(dropContext, ctx);

    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(updateOccSpy).not.toHaveBeenCalled();
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(ctx.clearSession).toHaveBeenCalled();
  });
});
