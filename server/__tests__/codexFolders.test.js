// The folder tree and the tag field. Split from the import itself because this
// is the half that must be RIGHT before 2,200 occurrences are minted into it: a
// folder tree that lands wrong is one delete, a 75-page import into the wrong
// folder is not.
import { describe, it, expect } from "vitest";
import { planCodexFolders, collectCodexTags } from "../migrations/0202-codex-folders-and-tags.mjs";

const files = [
  { relPath: "a.md", folder: "" },
  { relPath: "writing/b.md", folder: "writing" },
  { relPath: "writing/c.md", folder: "writing" },
  { relPath: "dreams/d.md", folder: "dreams" },
];
const ctx = { rootFolderId: "ROOT", userId: "U" };

describe("planCodexFolders", () => {
  it("makes one Codex folder plus one per source subfolder — never one per FILE", () => {
    const { folders } = planCodexFolders(files, ctx);
    expect(folders.map(f => f.name)).toEqual(["Codex", "dreams", "writing"]);
  });

  it("parents Codex at the manifest root and the rest under Codex", () => {
    const { folders } = planCodexFolders(files, ctx);
    const codex = folders.find(f => f.name === "Codex");
    expect(codex.parentId).toBe("ROOT");
    expect(folders.filter(f => f.name !== "Codex").every(f => f.parentId === codex.id)).toBe(true);
  });

  it("writes NO manifestId — the Folder schema has no such field", () => {
    // Mongoose strict mode strips it silently, so writing one is an inert key
    // that reads as scoping and does nothing. A rehearsal run is what caught it:
    // the idempotency query was manifestId-scoped, matched nothing, and would
    // have duplicated all 9 folders on the next apply.
    const { folders } = planCodexFolders(files, ctx);
    expect(folders.every(f => !("manifestId" in f))).toBe(true);
  });

  it("maps a root-level file to the Codex folder itself", () => {
    const { byRelFolder, folders } = planCodexFolders(files, ctx);
    expect(byRelFolder.get("")).toBe(folders.find(f => f.name === "Codex").id);
    expect(byRelFolder.get("writing")).toBe(folders.find(f => f.name === "writing").id);
  });
});

describe("collectCodexTags", () => {
  it("gathers every tag once, sorted", () => {
    const withTags = [{ tags: ["tech", "moduli"] }, { tags: ["tech"] }, { tags: ["dreams"] }];
    expect(collectCodexTags(withTags)).toEqual(["dreams", "moduli", "tech"]);
  });

  it("returns an empty list for no tags — the control", () => {
    expect(collectCodexTags([{ tags: [] }])).toEqual([]);
  });
});
