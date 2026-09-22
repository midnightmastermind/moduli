// An uploaded file stays where it was dropped (2026-09-21). The placement is
// written before the server has the file's row, so the server drops it as an
// unknown child; once the upload lands, artifactUpload re-links it into every
// parent that lists it locally, at the same position, quietly.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { relistUploaded, uploadArtifactPlaceholders } from "../helpers/artifactUpload";
import { operationsBridge } from "../state/bindSocketToStore";
import * as UploadHelpers from "../helpers/uploadWithProgress";
import * as CommitHelpers from "../helpers/CommitHelpers";

describe("relistUploaded", () => {
  let socket;
  beforeEach(() => {
    socket = { connected: true, emit: vi.fn() };
    operationsBridge.getParentsListing = (id) => id === "art" ? [{ parentId: "board", index: 2 }, { parentId: "page", index: 0 }] : [];
  });
  afterEach(() => { operationsBridge.getParentsListing = null; vi.restoreAllMocks(); });

  it("re-links into each parent that lists it, at its position, quietly", () => {
    expect(relistUploaded("art", socket)).toBe(2);
    expect(socket.emit).toHaveBeenCalledWith("link_occurrence_to_parent", { occurrenceId: "art", parentOccurrenceId: "board", index: 2, quiet: true });
    expect(socket.emit).toHaveBeenCalledWith("link_occurrence_to_parent", { occurrenceId: "art", parentOccurrenceId: "page", index: 0, quiet: true });
  });

  it("does nothing for an occurrence nothing lists (a Files-only upload)", () => {
    expect(relistUploaded("other", socket)).toBe(0);
    expect(socket.emit).not.toHaveBeenCalled();
  });

  it("a successful upload re-links; a failed one does not", async () => {
    vi.spyOn(CommitHelpers, "updateModule").mockImplementation(() => {});
    const up = vi.spyOn(UploadHelpers, "uploadFileWithProgress");
    const p = { file: new File(["x"], "a.png", { type: "image/png" }), moduleId: "m", occurrenceId: "art", module: { meta: {} } };

    up.mockResolvedValueOnce({ module: { id: "m" } });
    uploadArtifactPlaceholders([p], { gridId: "g", userId: "u", dispatch: vi.fn(), socket });
    await vi.waitFor(() => expect(socket.emit).toHaveBeenCalledWith("link_occurrence_to_parent", expect.objectContaining({ occurrenceId: "art" })));

    socket.emit.mockClear();
    up.mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    uploadArtifactPlaceholders([p], { gridId: "g", userId: "u", dispatch: vi.fn(), socket });
    await new Promise((r) => setTimeout(r, 20));
    expect(socket.emit).not.toHaveBeenCalledWith("link_occurrence_to_parent", expect.anything());
  });
});
