// server/__tests__/templatesFolder.test.js
//
// Templates are identified by LOCATION now — the children of the one protected
// "Templates" folder under the user manifest — not by a separate manifestType
// or the retired meta.templateName / module.meta.templateModule markers.
// See docs/superpowers/specs/2026-08-02-template-editing-design.md
import { describe, it, expect } from "vitest";
import { findTemplatesFolder, resolveTemplatesFolderId } from "../utils/templatesFolder.js";

const G = "g1";
const U = "u1";

function ucWith(folders) {
  return { foldersById: Object.fromEntries(folders.map(f => [f.id, f])) };
}

const templatesFolder = {
  id: "tpl-f", gridId: G, userId: U, name: "Templates", meta: { protected: true },
};

describe("findTemplatesFolder", () => {
  it("finds the protected Templates folder", () => {
    const uc = ucWith([templatesFolder, { id: "n", gridId: G, userId: U, name: "Notes" }]);
    expect(findTemplatesFolder(uc, { gridId: G, userId: U })?.id).toBe("tpl-f");
  });

  it("does NOT match a user folder that merely shares the name", () => {
    // Protection is carried by meta.protected, never by the name — the user may
    // legitimately keep their own folder called Templates elsewhere.
    const uc = ucWith([{ id: "mine", gridId: G, userId: U, name: "Templates" }]);
    expect(findTemplatesFolder(uc, { gridId: G, userId: U })).toBeNull();
  });

  it("is scoped to the grid AND the user", () => {
    const uc = ucWith([templatesFolder]);
    expect(findTemplatesFolder(uc, { gridId: "other", userId: U })).toBeNull();
    expect(findTemplatesFolder(uc, { gridId: G, userId: "other" })).toBeNull();
  });

  it("returns null on an empty cache instead of throwing", () => {
    expect(findTemplatesFolder({}, { gridId: G, userId: U })).toBeNull();
    expect(findTemplatesFolder(undefined, { gridId: G, userId: U })).toBeNull();
  });
});

describe("resolveTemplatesFolderId", () => {
  it("defaults to the Templates folder when no parent is supplied", () => {
    const uc = ucWith([templatesFolder]);
    expect(resolveTemplatesFolderId(uc, { gridId: G, userId: U })).toBe("tpl-f");
  });

  it("accepts a SUBFOLDER inside the Templates folder", () => {
    const sub = { id: "sub", gridId: G, userId: U, name: "Pages", parentId: "tpl-f" };
    const uc = ucWith([templatesFolder, sub]);
    expect(resolveTemplatesFolderId(uc, { gridId: G, userId: U, parentFolderId: "sub" })).toBe("sub");
  });

  it("REFUSES a folder outside the Templates folder", () => {
    // This is the guard that keeps a template write from landing in the user's
    // ordinary tree (or another user's).
    const outside = { id: "notes", gridId: G, userId: U, name: "Notes" };
    const uc = ucWith([templatesFolder, outside]);
    expect(resolveTemplatesFolderId(uc, { gridId: G, userId: U, parentFolderId: "notes" })).toBeNull();
  });

  it("refuses a folder belonging to another user even if it chains upward", () => {
    const foreign = { id: "f", gridId: G, userId: "other", name: "X", parentId: "tpl-f" };
    const uc = ucWith([templatesFolder, foreign]);
    expect(resolveTemplatesFolderId(uc, { gridId: G, userId: U, parentFolderId: "f" })).toBeNull();
  });

  it("returns null when the Templates folder does not exist yet", () => {
    // Pre-migration grids: the caller must surface an error, never silently
    // write the template somewhere else.
    expect(resolveTemplatesFolderId(ucWith([]), { gridId: G, userId: U })).toBeNull();
  });

  it("does not hang on a folder cycle", () => {
    const a = { id: "a", gridId: G, userId: U, name: "A", parentId: "b" };
    const b = { id: "b", gridId: G, userId: U, name: "B", parentId: "a" };
    expect(resolveTemplatesFolderId(ucWith([templatesFolder, a, b]), {
      gridId: G, userId: U, parentFolderId: "a",
    })).toBeNull();
  });
});
