// A file dropped from the OS onto a board lands IN the container under the
// pointer (2026-09-21, found rebuilding a grid through the UI).
//
// DragProvider's native drop fallback — the path OS file drops actually take —
// built its handler ctx with the bare store `state`, which carries `modules`
// as an ARRAY and no `modulesById`. dropView classifies the target by
// `state.modulesById[moduleId].role`, so the container resolved to nothing and
// handleFileDrop fell through to its empty-cell branch: a NEW PANEL + container
// named after the file, stacked into the cell, with the file inside it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { handleFileDrop } from "../helpers/dropHandlers";
import * as CommitHelpers from "../helpers/CommitHelpers";
import * as LayoutHelpers from "../helpers/LayoutHelpers";
import * as UploadHelpers from "../helpers/uploadWithProgress";

const modules = {
  panelMod: { id: "panelMod", role: "panel", kind: "board" },
  containerMod: { id: "containerMod", role: "container", kind: "board" },
};
const occs = {
  panelOcc: { id: "panelOcc", moduleId: "panelMod", occurrences: ["containerOcc"] },
  containerOcc: { id: "containerOcc", moduleId: "containerMod", occurrences: [] },
};

// The exact target shape DragProvider's native onDrop builds for a hovered container.
function nativeDrop(state) {
  const dropContext = {
    payload: { sourceKind: "file", data: { files: [{ name: "a.png", type: "image/png", size: 10 }] } },
    target: { occurrenceId: null, moduleId: "containerMod", kind: null, raw: {} },
    position: { edge: null, insertIndex: null },
    pointer: { x: 5, y: 5 },
  };
  const ctx = {
    dispatch: vi.fn(), socket: { emit: vi.fn() },
    state, occurrencesById: occs, baseContainers: [modules.containerMod],
    clearSession: vi.fn(), getCellFromPoint: () => ({ row: 0, col: 0 }),
  };
  return { dropContext, ctx };
}

const base = { gridId: "g1", userId: "u1", grid: { _id: "g1" }, viewsById: {}, modules: Object.values(modules) };

describe("OS file drop onto a container", () => {
  let panelSpy, updateOccSpy;
  beforeEach(() => {
    vi.spyOn(UploadHelpers, "uploadFileWithProgress").mockResolvedValue({ module: { id: "m", meta: { uploadStatus: "ready" } } });
    updateOccSpy = vi.spyOn(CommitHelpers, "updateOccurrence").mockImplementation(() => {});
    vi.spyOn(CommitHelpers, "updateModule").mockImplementation(() => {});
    panelSpy = vi.spyOn(LayoutHelpers, "createPanelInGrid").mockReturnValue({ occurrence: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it("lands in the container when the ctx carries modulesById", () => {
    const { dropContext, ctx } = nativeDrop({ ...base, modulesById: modules });
    handleFileDrop(dropContext, ctx);
    expect(panelSpy).not.toHaveBeenCalled();
    expect(updateOccSpy.mock.calls.some(([a]) => a.occurrence.id === "containerOcc")).toBe(true);
  });

  it("CONTROL: the bare store state (no modulesById) is what minted a panel", () => {
    const { dropContext, ctx } = nativeDrop(base);
    handleFileDrop(dropContext, ctx);
    expect(panelSpy).toHaveBeenCalled();
  });

  it("DragProvider's native drop hands the handlers modulesById", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, "../helpers/DragProvider.jsx"), "utf8");
    const body = src.slice(src.indexOf("const onDrop = (e) =>"), src.indexOf('gridFrame.addEventListener("dragover"'));
    expect(body).toMatch(/const ctx = \{[^}]*state: \{ \.\.\.state, modulesById \}/);
  });
});
