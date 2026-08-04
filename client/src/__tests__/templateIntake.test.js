// client/src/__tests__/templateIntake.test.js
//
// Dropping a page onto the protected Templates folder must COPY. Without this,
// dragging your real Schedule page in to "make a template of it" would MOVE it
// out of Interfaces and break the app.
import { describe, it, expect } from "vitest";
import { resolveFolderDrop } from "../modules/ManifestTree";

const templatesFolder = { id: "tpl-f", name: "Templates", meta: { protected: true } };
const notesFolder = { id: "notes-f", name: "Notes" };

describe("dropping a page onto a folder", () => {
  it("COPIES into the Templates folder — never moves the original", () => {
    expect(resolveFolderDrop({ folder: templatesFolder })).toBe("copy");
  });

  it("still MOVES into an ordinary folder", () => {
    expect(resolveFolderDrop({ folder: notesFolder })).toBe("move");
  });

  it("does NOT copy into a user folder that merely shares the name", () => {
    // Protection is carried by meta.protected, never the name.
    expect(resolveFolderDrop({ folder: { id: "mine", name: "Templates" } })).toBe("move");
  });

  it("treats a missing folder as a move (existing behaviour unchanged)", () => {
    expect(resolveFolderDrop({ folder: null })).toBe("move");
    expect(resolveFolderDrop({})).toBe("move");
  });
});
