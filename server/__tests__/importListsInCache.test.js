// AN IMPORTED PAGE MUST APPEAR IN ITS DESTINATION WITHOUT A SERVER RESTART.
//
// Found rebuilding poms grid through the UI (2026-09-22): paste a link over a
// Bookmarks container -> "Import the page". The tree was written and Mongo's
// Bookmarks listed it, but the server's WARM CACHE did not, and no tab was told
// — so the page was invisible everywhere until pm2 restarted:
//
//     mongo Bookmarks.occurrences   [bookmark, 64d6d068]   <- the import
//     cache Bookmarks.occurrences   [bookmark]
//
// Why: the default ("magic") shape's `markdownToModuli` $pushes its own root,
// so `linkRootIntoParent`'s `$ne` guard found it already listed and returned
// null — and both handlers only synced the cache and broadcast `if (linked)`.
import { describe, it, expect, vi, beforeEach } from "vitest";

const findOneAndUpdate = vi.fn();
const findOne = vi.fn();
vi.mock("../models/Occurrence.js", () => ({ default: { findOneAndUpdate: (...a) => findOneAndUpdate(...a), findOne: (...a) => findOne(...a) } }));

const { linkRootIntoParent } = await import("../utils/linkRootIntoParent.js");

beforeEach(() => { findOneAndUpdate.mockReset(); findOne.mockReset(); });

describe("linkRootIntoParent", () => {
  it("hands back the parent when the importer ALREADY listed the root", async () => {
    const parent = { id: "dest", occurrences: ["old", "root"] };
    findOneAndUpdate.mockResolvedValue(null);          // $ne guard: already there
    findOne.mockResolvedValue(parent);
    expect(await linkRootIntoParent({ parentId: "dest", childId: "root", userId: "u" })).toBe(parent);
  });

  it("hands back the parent it pushed into (control)", async () => {
    const parent = { id: "dest", occurrences: ["old", "root"] };
    findOneAndUpdate.mockResolvedValue(parent);
    expect(await linkRootIntoParent({ parentId: "dest", childId: "root", userId: "u" })).toBe(parent);
    expect(findOne).not.toHaveBeenCalled();
  });

  it("returns null when there is no such parent", async () => {
    findOneAndUpdate.mockResolvedValue(null);
    findOne.mockResolvedValue(null);
    expect(await linkRootIntoParent({ parentId: "gone", childId: "root", userId: "u" })).toBeNull();
  });
});
