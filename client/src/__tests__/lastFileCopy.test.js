// Removing an uploaded file from a board or doc (user, 2026-10-22: "if we delete the last occurance of a file
// (outside the file tree), we should ask if we want the file deleted too").
import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("../ui/ChoiceDialog.jsx", () => ({ askChoice: vi.fn() }));
vi.mock("../helpers/CommitHelpers.js", () => ({ deleteOccurrence: vi.fn(), removeOccurrence: vi.fn(), updateOccurrence: vi.fn() }));
import { askChoice } from "../ui/ChoiceDialog.jsx";
import * as CommitHelpers from "../helpers/CommitHelpers.js";
import { stillPlacedOutsideFiles, removeOccurrenceOfferingFile } from "../helpers/lastFileCopy.js";

const folders = { "files-video": { id: "files-video" } };
const mod = { id: "m", role: "artifact", kind: "video", fileRef: "gdrive:c:x", label: "clip.mp4" };
const home = { id: "home", moduleId: "m", parentId: "files-video" };
const board = { id: "board", occurrences: ["home"] };
const doc = { id: "doc", textmap: { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "home" } }] } };
const copy = { id: "copy", moduleId: "m", parentId: "doc2" };
const map = (...os) => Object.fromEntries(os.map((o) => [o.id, o]));
// The REAL store shape: `folders` is an array (there is no foldersById on state). The first version of these
// tests handed in a foldersById, passed, and the helper recognised no folder at all in the app.
const ctx = (...os) => ({ getState: () => ({ modules: [mod], folders: Object.values(folders) }), getOccMap: () => map(...os) });

beforeEach(() => { vi.clearAllMocks(); askChoice.mockResolvedValue(null); });

describe("stillPlacedOutsideFiles", () => {
  it("the home leaving its only board → nothing left outside Files", () => {
    expect(stillPlacedOutsideFiles({ module: mod, removingOccId: "home", fromParentId: "board", occurrencesById: map(home, board), foldersById: folders })).toBe(false);
  });
  it("the home is still embedded in a doc → still placed", () => {
    expect(stillPlacedOutsideFiles({ module: mod, removingOccId: "home", fromParentId: "board", occurrencesById: map(home, board, doc), foldersById: folders })).toBe(true);
  });
  it("another copy exists → still placed", () => {
    expect(stillPlacedOutsideFiles({ module: mod, removingOccId: "home", fromParentId: "board", occurrencesById: map(home, board, copy), foldersById: folders })).toBe(true);
  });
  it("the viewer's hidden page, a folder page and a file's own page do not count", () => {
    const spread = { id: "sp", occurrences: ["home"], meta: { spreadFor: "x" } };
    const fp = { id: "fp", occurrences: ["home"], meta: { folderPage: true } };
    const ap = { id: "ap", occurrences: ["home"], meta: { artifactPage: "home" } };
    expect(stillPlacedOutsideFiles({ module: mod, removingOccId: "home", fromParentId: "board", occurrencesById: map(home, board, spread, fp, ap), foldersById: folders })).toBe(false);
  });
});

describe("removeOccurrenceOfferingFile", () => {
  it("removing the HOME from a board only takes it off the board (the file is not deleted), then asks", async () => {
    removeOccurrenceOfferingFile({ dispatch: () => {}, socket: {}, occurrence: home, parentOccurrence: board, ...ctx(home, board) });
    expect(CommitHelpers.removeOccurrence).not.toHaveBeenCalled();
    expect(CommitHelpers.updateOccurrence).toHaveBeenCalledWith(expect.objectContaining({ occurrence: { id: "board", occurrences: [] } }));
    expect(askChoice).toHaveBeenCalled();
  });
  it("'Delete the file' deletes the home", async () => {
    askChoice.mockResolvedValueOnce("delete");
    removeOccurrenceOfferingFile({ dispatch: () => {}, socket: {}, occurrence: home, parentOccurrence: board, ...ctx(home, board) });
    await Promise.resolve(); await Promise.resolve();
    expect(CommitHelpers.deleteOccurrence).toHaveBeenCalledWith(expect.objectContaining({ occurrenceId: "home" }));
  });
  it("removing a COPY deletes the copy; asks when nothing else shows the file", () => {
    removeOccurrenceOfferingFile({ dispatch: () => {}, socket: {}, occurrence: copy, parentOccurrence: { id: "doc2", occurrences: ["copy"] }, ...ctx(home, copy) });
    expect(CommitHelpers.removeOccurrence).toHaveBeenCalledWith(expect.objectContaining({ occurrenceId: "copy" }));
    expect(askChoice).toHaveBeenCalled();
  });
  // Controls: no question while the file is still shown elsewhere, and none for a non-upload.
  it("no question when the file is still shown elsewhere, or for a non-upload", () => {
    removeOccurrenceOfferingFile({ dispatch: () => {}, socket: {}, occurrence: home, parentOccurrence: board, ...ctx(home, board, doc) });
    expect(askChoice).not.toHaveBeenCalled();
    const row = { id: "r", moduleId: "i", parentId: "c" };
    removeOccurrenceOfferingFile({ dispatch: () => {}, socket: {}, occurrence: row, parentOccurrence: { id: "c", occurrences: ["r"] },
      getState: () => ({ modules: [{ id: "i", role: "instance" }], folders: Object.values(folders) }), getOccMap: () => map(row) });
    expect(askChoice).not.toHaveBeenCalled();
    expect(CommitHelpers.removeOccurrence).toHaveBeenCalledWith(expect.objectContaining({ occurrenceId: "r" }));
  });
  // Measured on prod 2026-10-22: a file with TWO placements in Files. The first version took only the first
  // one it found as "the file", treated the board's row as a copy, sent a plain delete — and the server,
  // which deletes the whole file when a Files placement is deleted, deleted it with no question.
  it("a second placement in Files is unlisted from the board, never deleted", () => {
    const home2 = { id: "home2", moduleId: "m", parentId: "files-video" };
    const board2 = { id: "board2", occurrences: ["home2"] };
    removeOccurrenceOfferingFile({ dispatch: () => {}, socket: {}, occurrence: home2, parentOccurrence: board2, ...ctx(home, home2, board2) });
    expect(CommitHelpers.removeOccurrence).not.toHaveBeenCalled();
    expect(CommitHelpers.updateOccurrence).toHaveBeenCalledWith(expect.objectContaining({ occurrence: { id: "board2", occurrences: [] } }));
    expect(askChoice).toHaveBeenCalled();
  });
});
