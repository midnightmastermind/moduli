// 0225 — the drop predicate. A folder delete has no undo, so every refusal is
// a test rather than a comment.
import { describe, it, expect } from "vitest";
import { isDroppable, EMPTIED_BY_0224 } from "../migrations/0225-drop-emptied-source-folders.mjs";

const empty = { childFolders: 0, parentedOccs: 0, listedAnywhere: 0 };

describe("isDroppable — empty three ways, and only what 0224 emptied", () => {
  it("drops the husk 0224 left", () => {
    expect(isDroppable({ name: "Bookmarks" }, empty)).toMatchObject({ drop: true });
  });

  it("REFUSES a folder 0224 never touched, however empty it is", () => {
    // `Root/Interests/Music` and `Root/Files/Documents` are both empty on poms
    // grid right now and are the user's, not this migration's business.
    expect(isDroppable({ name: "Interests" }, empty).drop).toBe(false);
    expect(isDroppable({ name: "Documents" }, empty).drop).toBe(false);
  });

  it("refuses when it still holds a subfolder", () => {
    expect(isDroppable({ name: "Bookmarks" }, { ...empty, childFolders: 1 }).drop).toBe(false);
  });

  it("refuses when a page is still parented to it", () => {
    expect(isDroppable({ name: "Bookmarks" }, { ...empty, parentedOccs: 1 }).drop).toBe(false);
  });

  it("refuses when something LISTS it, even with nothing parented", () => {
    // The reachability path a parentId scan cannot see — the third way, and the
    // one 2026-08-07 (8) was paid for missing.
    expect(isDroppable({ name: "Bookmarks" }, { ...empty, listedAnywhere: 1 }).drop).toBe(false);
  });

  it("refuses a folder that does not exist rather than throwing", () => {
    expect(isDroppable(null, empty).drop).toBe(false);
  });

  it("the allowlist stays narrow — a widened one is the thing to catch in review", () => {
    expect(EMPTIED_BY_0224).toEqual(["Bookmarks"]);
  });
});
