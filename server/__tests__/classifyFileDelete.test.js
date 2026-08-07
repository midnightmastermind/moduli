// Task 4 Step 5 — placement-delete vs file-delete.
//
// THE SHAPE THIS IS WRITTEN AGAINST IS REAL, NOT HYPOTHETICAL. Measured on poms
// grid 2026-08-07: ten imported Eminem images are homed in Files/Images (given
// that home by migration 0051) AND listed by their Wikipedia section container.
// One occurrence, two homes. Deleting one from the page today deletes the file
// out of Files with it, because it is the same row — which is precisely the
// failure this rule exists to stop.
//
// The census also settles what does NOT exist yet, which is why every shape here
// is constructed rather than loaded: ZERO markdown artifacts and ZERO artifact
// modules with more than one occurrence on any grid. The copy-per-placement
// semantic has no live instance, so its tests describe a rule being established
// ahead of its data.

import { describe, it, expect } from "vitest";
import { classifyFileDelete } from "../utils/filesFolder.js";

const FILES = new Set(["files-root", "files-images", "files-documents"]);

// An artifact homed in Files, of the kind under test.
const homed = (over = {}) => ({
  id: "occ-1",
  moduleId: "mod-1",
  parentId: "files-images",
  ...over,
});

describe("classifyFileDelete — a placement is not the file", () => {
  it("unlinks when the delete comes from a parent that is NOT the Files home", () => {
    // The live Eminem case: delete the image off the section container.
    const got = classifyFileDelete({
      occurrence: homed(),
      fromParentId: "section-container",
      filesFolderIds: FILES,
    });
    expect(got.action).toBe("unlink");
    expect(got.parentId).toBe("section-container");
  });

  it("deletes the FILE when the delete comes from inside Files itself", () => {
    const got = classifyFileDelete({
      occurrence: homed(),
      fromParentId: "files-images",
      filesFolderIds: FILES,
    });
    expect(got.action).toBe("delete-file");
  });

  it("deletes the FILE when no parent context is given at all", () => {
    // A caller that cannot say where the delete came from must not silently
    // unlink from nowhere — the conservative reading of a bare delete is that
    // the user meant the file.
    const got = classifyFileDelete({
      occurrence: homed(),
      fromParentId: null,
      filesFolderIds: FILES,
    });
    expect(got.action).toBe("delete-file");
  });

  it("sweeps the module's other occurrences on a file delete — the COPY placements", () => {
    const got = classifyFileDelete({
      occurrence: homed(),
      fromParentId: "files-images",
      filesFolderIds: FILES,
    });
    // "deleting it in Files removes it everywhere" only means something if the
    // copies go too. One module, N occurrences is the copy semantic's whole shape.
    expect(got.sweepModuleId).toBe("mod-1");
  });
});

describe("classifyFileDelete — refusals, which are the load-bearing half", () => {
  it("is an ORDINARY delete for an occurrence that is not homed in Files", () => {
    // A copy placement is its own row with its own parent. Deleting it has
    // always been correct and must not start unlinking instead.
    const got = classifyFileDelete({
      occurrence: homed({ parentId: "some-container" }),
      fromParentId: "some-container",
      filesFolderIds: FILES,
    });
    expect(got.action).toBe("delete-occurrence");
    expect(got.sweepModuleId).toBeNull();
  });

  it("is an ORDINARY delete when the grid has no Files folder", () => {
    // A grid that never ran 0049 must behave byte-identically to before this
    // rule existed. "No Files folder" is not "the wrong folder".
    const got = classifyFileDelete({
      occurrence: homed(),
      fromParentId: "section-container",
      filesFolderIds: new Set(),
    });
    expect(got.action).toBe("delete-occurrence");
  });

  it("does not unlink an occurrence from its own Files home by a stale parent id", () => {
    // Discriminating sibling for the first test: the SAME call shape, but the
    // parent IS the home. Without this, "unlink whenever a parent is named"
    // would pass the suite and orphan the file on a delete inside Files.
    const inFiles = classifyFileDelete({
      occurrence: homed({ parentId: "files-documents" }),
      fromParentId: "files-documents",
      filesFolderIds: FILES,
    });
    expect(inFiles.action).toBe("delete-file");
  });

  it("handles a null occurrence without throwing", () => {
    expect(classifyFileDelete({ occurrence: null, filesFolderIds: FILES }).action)
      .toBe("delete-occurrence");
  });
});
