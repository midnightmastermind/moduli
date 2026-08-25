import { describe, it, expect, vi, beforeEach } from "vitest";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { ensureImportsFolder, ensureImportsFolderAndPage, createImportsDocPage, shouldWrapImportOutput, ensureArtifactPageOcc, ensureFolderPageOcc, __resetFolderPageLatch } from "../helpers/importsFolder";

vi.mock("../helpers/CommitHelpers", () => ({
  createFolder: vi.fn(),
  updateFolder: vi.fn(),
  createPage: vi.fn(),
  createModule: vi.fn(),
  createOccurrence: vi.fn(),
  createView: vi.fn(),
  updateOccurrence: vi.fn(),
}));

const grid = { _id: "grid-1", manifestId: "mfst-1" };
const manifests = [{ id: "mfst-1", rootFolderId: "root-1" }];
const baseArgs = { grid, manifests, dispatch: vi.fn(), socket: {}, userId: "u1" };

beforeEach(() => { vi.clearAllMocks(); __resetFolderPageLatch(); });

describe("ensureFolderPageOcc — one folder page per folder", () => {
  const args = { gridId: "grid-1", userId: "u1", dispatch: vi.fn(), socket: {} };

  it("mints a folder page when the folder has none", () => {
    const id = ensureFolderPageOcc({ ...args, folderId: "f1", label: "Trackers", occurrencesById: {} });
    expect(id).toBeTruthy();
    expect(CommitHelpers.createOccurrence).toHaveBeenCalledTimes(1);
  });

  it("returns the EXISTING page without minting", () => {
    const occurrencesById = { a: { id: "a", parentId: "f1", meta: { folderPage: true } } };
    expect(ensureFolderPageOcc({ ...args, folderId: "f1", occurrencesById })).toBe("a");
    expect(CommitHelpers.createOccurrence).not.toHaveBeenCalled();
  });

  it("SAME-TICK second caller does not mint a second page", () => {
    // THE DISCRIMINATING CASE. Both callers resolved the occurrence map before
    // either write landed, so both see "no page yet" — which is how 8 folders
    // on poms grid ended up with two apiece, and a folder page then listed
    // ITSELF forever. Passing the SAME stale map to both is the whole point.
    const stale = {};
    const first = ensureFolderPageOcc({ ...args, folderId: "f1", occurrencesById: stale });
    const second = ensureFolderPageOcc({ ...args, folderId: "f1", occurrencesById: stale });
    expect(second).toBe(first);
    expect(CommitHelpers.createOccurrence).toHaveBeenCalledTimes(1);
  });

  it("the latch is PER FOLDER — a different folder still mints", () => {
    const stale = {};
    ensureFolderPageOcc({ ...args, folderId: "f1", occurrencesById: stale });
    ensureFolderPageOcc({ ...args, folderId: "f2", occurrencesById: stale });
    expect(CommitHelpers.createOccurrence).toHaveBeenCalledTimes(2);
  });

  it("the latch is PER GRID — the same folder id on another grid still mints", () => {
    const stale = {};
    ensureFolderPageOcc({ ...args, gridId: "grid-1", folderId: "f1", occurrencesById: stale });
    ensureFolderPageOcc({ ...args, gridId: "grid-2", folderId: "f1", occurrencesById: stale });
    expect(CommitHelpers.createOccurrence).toHaveBeenCalledTimes(2);
  });
});

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

  // Imports is structural — the app files things there without asking, and the
  // next import re-mints it anyway, so deleting it is destructive AND not
  // durable. `meta.protected` is what `assertNotProtectedFolder` reads.
  it("mints the Imports folder PROTECTED", () => {
    ensureImportsFolder({ ...baseArgs, folders: [] });
    expect(CommitHelpers.createFolder.mock.calls[0][0].folder.meta).toEqual({ protected: true });
  });

  it("self-heals a folder minted before protection existed", () => {
    const folders = [{ id: "imp-1", name: "Imports", parentId: "root-1", gridId: "grid-1" }];
    ensureImportsFolder({ ...baseArgs, folders });
    expect(CommitHelpers.createFolder).not.toHaveBeenCalled();
    expect(CommitHelpers.updateFolder.mock.calls[0][0].folder)
      .toMatchObject({ id: "imp-1", meta: { protected: true } });
  });

  // MERGE, never replace: the folder carries more than this flag (meta.cover).
  it("preserves the rest of meta when stamping protection", () => {
    const folders = [{ id: "imp-1", name: "Imports", parentId: "root-1", gridId: "grid-1", meta: { cover: "x.png" } }];
    ensureImportsFolder({ ...baseArgs, folders });
    expect(CommitHelpers.updateFolder.mock.calls[0][0].folder.meta)
      .toEqual({ cover: "x.png", protected: true });
  });

  it("writes nothing when the folder is already protected", () => {
    const folders = [{ id: "imp-1", name: "Imports", parentId: "root-1", gridId: "grid-1", meta: { protected: true } }];
    ensureImportsFolder({ ...baseArgs, folders });
    expect(CommitHelpers.createFolder).not.toHaveBeenCalled();
    expect(CommitHelpers.updateFolder).not.toHaveBeenCalled();
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

describe("ensureArtifactPageOcc (2026-07-12 — artifact full-screen page)", () => {
  const artifactWorld = () => ({
    occurrencesById: {
      "art-1": { id: "art-1", moduleId: "mod-art" },
    },
    modulesById: {
      "mod-art": { id: "mod-art", role: "artifact", kind: "image", label: "Sunset.jpg" },
    },
    gridId: "grid-1", userId: "u1", dispatch: vi.fn(), socket: {},
  });

  beforeEach(() => { vi.clearAllMocks(); });

  it("mints a role:page kind:display page fronting the artifact", () => {
    const args = artifactWorld();
    const pageOccId = ensureArtifactPageOcc({ artifactOccId: "art-1", ...args });
    expect(pageOccId).toBeTruthy();
    const mod = CommitHelpers.createModule.mock.calls[0][0].module;
    expect(mod.role).toBe("page");
    expect(mod.kind).toBe("display");
    expect(mod.label).toBe("Sunset.jpg");
    const occ = CommitHelpers.createOccurrence.mock.calls[0][0].occurrence;
    expect(occ.meta.artifactPage).toBe("art-1");
    expect(occ.occurrences).toEqual(["art-1"]);
    expect(occ.parentId).toBeNull(); // never a tree row of its own
    // The page carries a REAL View routing the artifact kind (no renderer-side
    // synthesized view) — image → display/image, activated on the artifact.
    const view = CommitHelpers.createView.mock.calls[0][0].view;
    expect(view.viewType).toBe("display");
    expect(view.artifactType).toBe("image");
    expect(view.activeOccurrenceId).toBe("art-1");
    expect(occ.viewId).toBe(view.id);
  });

  it("is idempotent — an existing artifact page is reused", () => {
    const args = artifactWorld();
    args.occurrencesById["page-x"] = { id: "page-x", meta: { artifactPage: "art-1" } };
    const pageOccId = ensureArtifactPageOcc({ artifactOccId: "art-1", ...args });
    expect(pageOccId).toBe("page-x");
    expect(CommitHelpers.createModule).not.toHaveBeenCalled();
    expect(CommitHelpers.createOccurrence).not.toHaveBeenCalled();
  });

  it("returns null when the artifact can't resolve", () => {
    const args = artifactWorld();
    expect(ensureArtifactPageOcc({ artifactOccId: "missing", ...args })).toBeNull();
    expect(CommitHelpers.createModule).not.toHaveBeenCalled();
  });

  it("owns the role gate — a NON-artifact occurrence returns null (call sites fall through)", () => {
    const args = artifactWorld();
    args.occurrencesById["doc-1"] = { id: "doc-1", moduleId: "mod-doc" };
    args.modulesById["mod-doc"] = { id: "mod-doc", role: "page", kind: "doc" };
    expect(ensureArtifactPageOcc({ artifactOccId: "doc-1", ...args })).toBeNull();
    expect(CommitHelpers.createModule).not.toHaveBeenCalled();
  });
});
