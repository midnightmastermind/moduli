import { describe, it, expect, vi, beforeEach } from "vitest";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { ensureImportsFolder, ensureImportsFolderAndPage, createImportsDocPage, shouldWrapImportOutput } from "../helpers/importsFolder";

vi.mock("../helpers/CommitHelpers", () => ({
  createFolder: vi.fn(),
  createPage: vi.fn(),
  createModule: vi.fn(),
  createOccurrence: vi.fn(),
}));

const grid = { _id: "grid-1", manifestId: "mfst-1" };
const manifests = [{ id: "mfst-1", rootFolderId: "root-1" }];
const baseArgs = { grid, manifests, dispatch: vi.fn(), socket: {}, userId: "u1" };

beforeEach(() => vi.clearAllMocks());

describe("shouldWrapImportOutput", () => {
  it("wraps a real import (root present, not a dry run)", () => {
    expect(shouldWrapImportOutput({ rootOccurrenceId: "occ-1", dryRun: false })).toBe(true);
    expect(shouldWrapImportOutput({ rootOccurrenceId: "occ-1" })).toBe(true);
  });
  it("does NOT wrap a dry run even when it returns a planned root (the empty-embed bug)", () => {
    expect(shouldWrapImportOutput({ rootOccurrenceId: "occ-1", dryRun: true })).toBe(false);
  });
  it("does NOT wrap when there is no root id, or output is missing", () => {
    expect(shouldWrapImportOutput({ dryRun: false })).toBe(false);
    expect(shouldWrapImportOutput(null)).toBe(false);
    expect(shouldWrapImportOutput(undefined)).toBe(false);
  });
});

describe("ensureImportsFolder", () => {
  it("reuses an existing Imports folder under the manifest root (no create)", () => {
    const folders = [{ id: "imp-1", name: "Imports", parentId: "root-1", gridId: "grid-1" }];
    const id = ensureImportsFolder({ ...baseArgs, folders });
    expect(id).toBe("imp-1");
    expect(CommitHelpers.createFolder).not.toHaveBeenCalled();
  });

  it("creates the Imports folder under the manifest root when absent", () => {
    const id = ensureImportsFolder({ ...baseArgs, folders: [] });
    expect(CommitHelpers.createFolder).toHaveBeenCalledTimes(1);
    const folder = CommitHelpers.createFolder.mock.calls[0][0].folder;
    expect(folder.name).toBe("Imports");
    expect(folder.parentId).toBe("root-1");
    expect(folder.gridId).toBe("grid-1");
    expect(folder.id).toBe(id);
  });

  it("does not reuse an Imports folder from a different grid", () => {
    const folders = [{ id: "imp-other", name: "Imports", parentId: "root-1", gridId: "grid-OTHER" }];
    const id = ensureImportsFolder({ ...baseArgs, folders });
    expect(CommitHelpers.createFolder).toHaveBeenCalledTimes(1);
    expect(id).not.toBe("imp-other");
  });
});

describe("ensureImportsFolderAndPage", () => {
  it("mints a folder-page occurrence so the Imports folder shows as a card", () => {
    const folders = [{ id: "imp-1", name: "Imports", parentId: "root-1", gridId: "grid-1" }];
    const { folderId, folderPageOccId } = ensureImportsFolderAndPage({ ...baseArgs, folders, occurrencesById: {} });
    expect(folderId).toBe("imp-1");
    expect(CommitHelpers.createModule).toHaveBeenCalledTimes(1);
    expect(CommitHelpers.createOccurrence).toHaveBeenCalledTimes(1);
    const mod = CommitHelpers.createModule.mock.calls[0][0].module;
    expect(mod.role).toBe("page");
    expect(mod.kind).toBe("folder");
    const occ = CommitHelpers.createOccurrence.mock.calls[0][0].occurrence;
    expect(occ.id).toBe(folderPageOccId);
    expect(occ.parentId).toBe("imp-1");          // folder-page occ lives under Imports
    expect(occ.meta.folderPage).toBe(true);       // self-identifying idempotency tag
  });

  it("reuses an existing folder-page occurrence (idempotent across imports)", () => {
    const folders = [{ id: "imp-1", name: "Imports", parentId: "root-1", gridId: "grid-1" }];
    const occurrencesById = {
      "fp-existing": { id: "fp-existing", parentId: "imp-1", meta: { folderPage: true } },
    };
    const { folderPageOccId } = ensureImportsFolderAndPage({ ...baseArgs, folders, occurrencesById });
    expect(folderPageOccId).toBe("fp-existing");
    expect(CommitHelpers.createModule).not.toHaveBeenCalled();
    expect(CommitHelpers.createOccurrence).not.toHaveBeenCalled();
  });
});

describe("createImportsDocPage", () => {
  it("wraps the root in a doc page parented under Imports and pinned to the panel", () => {
    const folders = [{ id: "imp-1", name: "Imports", parentId: "root-1", gridId: "grid-1" }];
    const pageOccId = createImportsDocPage({
      ...baseArgs, folders, rootOccId: "root-occ", panelOccurrenceId: "panel-1", label: "Eminem",
    });
    expect(CommitHelpers.createPage).toHaveBeenCalledTimes(1);
    const { module, occurrence, panelOccurrenceId } = CommitHelpers.createPage.mock.calls[0][0];
    expect(module.role).toBe("page");
    expect(module.kind).toBe("doc");
    expect(module.label).toBe("Eminem");
    expect(occurrence.id).toBe(pageOccId);
    expect(occurrence.parentId).toBe("imp-1");          // grouped under Imports
    expect(occurrence.occurrences).toEqual(["root-occ"]); // multi-parents the content
    expect(occurrence.textmap.content[0]).toEqual({
      type: "moduleEmbed", attrs: { occurrenceId: "root-occ" },
    });
    expect(panelOccurrenceId).toBe("panel-1");          // pinned to the panel
  });
});
