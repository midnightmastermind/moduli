import { describe, it, expect } from "vitest";
import {
  TEMPLATES_FOLDER_NAME, isProtectedFolder, assertNotProtectedFolder,
} from "../utils/protectedFolders.js";

describe("protected folders", () => {
  it("recognises the Templates folder by its protected flag", () => {
    expect(isProtectedFolder({ name: "Templates", meta: { protected: true } })).toBe(true);
  });

  it("does NOT protect a user folder that merely shares the name", () => {
    // Name alone must not protect — the user may legitimately have their own
    // folder called Templates somewhere else in the tree.
    expect(isProtectedFolder({ name: TEMPLATES_FOLDER_NAME })).toBe(false);
  });

  it("THROWS rather than returning false — a boolean someone forgets to check is not a guard", () => {
    expect(() => assertNotProtectedFolder({ name: "Templates", meta: { protected: true } }, "delete"))
      .toThrow(/protected/i);
  });

  it("lets an ordinary folder through", () => {
    expect(() => assertNotProtectedFolder({ name: "Notes" })).not.toThrow();
    expect(isProtectedFolder(null)).toBe(false);
  });
});
