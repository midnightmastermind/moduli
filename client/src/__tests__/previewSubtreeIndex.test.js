import { describe, it, expect, beforeEach } from "vitest";
import {
  occurrenceIndexFor,
  collectSubtreeIds,
  __resetPreviewIndexCache,
} from "../helpers/previewSubtreeIndex.js";

const occ = (id, extra = {}) => ({ id, ...extra });

beforeEach(() => __resetPreviewIndexCache());

describe("occurrenceIndexFor", () => {
  it("indexes by id and by parentId", () => {
    const all = [
      occ("root"),
      occ("a", { parentId: "root" }),
      occ("b", { parentId: "root" }),
      occ("c", { parentId: "a" }),
    ];
    const { byId, childIdsByParentId } = occurrenceIndexFor(all);
    expect(byId.c.parentId).toBe("a");
    expect(childIdsByParentId.get("root")).toEqual(["a", "b"]);
    expect(childIdsByParentId.get("a")).toEqual(["c"]);
  });

  it("REUSES the index for the same array, and rebuilds for a new one", () => {
    // The array identity IS the version — the reducer swaps it on every write,
    // so a hit on the same array is safe and a new array can never be stale.
    const all = [occ("root")];
    expect(occurrenceIndexFor(all)).toBe(occurrenceIndexFor(all));
    expect(occurrenceIndexFor([occ("root")])).not.toBe(occurrenceIndexFor(all));
  });

  it("survives a null/!Array input rather than throwing", () => {
    const idx = occurrenceIndexFor(null);
    expect(idx.byId).toEqual({});
    expect(idx.childIdsByParentId.size).toBe(0);
  });
});

describe("collectSubtreeIds", () => {
  it("walks the child LIST down from the root", () => {
    const all = [
      occ("page", { occurrences: ["c1"] }),
      occ("c1", { occurrences: ["i1", "i2"] }),
      occ("i1"),
      occ("i2"),
      occ("elsewhere"),
    ];
    const seen = collectSubtreeIds({
      rootOccurrenceId: "page",
      index: occurrenceIndexFor(all),
    });
    expect([...seen].sort()).toEqual(["c1", "i1", "i2", "page"]);
  });

  it("closes over parentId TRANSITIVELY (the old fixpoint)", () => {
    const all = [
      occ("page"),
      occ("a", { parentId: "page" }),
      occ("b", { parentId: "a" }),
      occ("c", { parentId: "b" }),
    ];
    const seen = collectSubtreeIds({
      rootOccurrenceId: "page",
      index: occurrenceIndexFor(all),
    });
    expect([...seen].sort()).toEqual(["a", "b", "c", "page"]);
  });

  it("seeds the folder's own children — nothing else can reach them", () => {
    // A folder is not an occurrence, so no walk from the page arrives here.
    const all = [
      occ("page", { parentId: "folder1" }),
      occ("sibling", { parentId: "folder1" }),
      occ("other", { parentId: "folder2" }),
    ];
    const seen = collectSubtreeIds({
      rootOccurrenceId: "page",
      index: occurrenceIndexFor(all),
      folderIds: ["folder1"],
    });
    expect(seen.has("sibling")).toBe(true);
    expect(seen.has("other")).toBe(false);
  });

  it("does NOT follow a folder-seeded node's own child LIST", () => {
    // THE DISCRIMINATING CASE. Merging the two phases into one worklist looks
    // like a simplification and is a behaviour change: on poms grid it pulled
    // 371 extra containers into every root-folder card. `deep` is reachable
    // only through a folder-seeded page's `occurrences[]`, so it must stay out.
    const all = [
      occ("page", { parentId: "folder1" }),
      occ("sibling", { parentId: "folder1", occurrences: ["deep"] }),
      occ("deep"),
    ];
    const seen = collectSubtreeIds({
      rootOccurrenceId: "page",
      index: occurrenceIndexFor(all),
      folderIds: ["folder1"],
    });
    expect(seen.has("sibling")).toBe(true);
    expect(seen.has("deep")).toBe(false);
  });

  it("still closes over parentId FROM a folder-seeded node", () => {
    // The other side of the same boundary: the parentId phase seeds from
    // everything already seen, folder-seeded nodes included.
    const all = [
      occ("page", { parentId: "folder1" }),
      occ("sibling", { parentId: "folder1" }),
      occ("kid", { parentId: "sibling" }),
    ];
    const seen = collectSubtreeIds({
      rootOccurrenceId: "page",
      index: occurrenceIndexFor(all),
      folderIds: ["folder1"],
    });
    expect(seen.has("kid")).toBe(true);
  });

  it("keeps a DANGLING child ref instead of truncating the walk", () => {
    // The id is added before the lookup, so a parent that lists a missing
    // child still has its remaining children walked. The occurrence build
    // drops the phantom afterwards.
    const all = [occ("page", { occurrences: ["ghost", "real"] }), occ("real")];
    const seen = collectSubtreeIds({
      rootOccurrenceId: "page",
      index: occurrenceIndexFor(all),
    });
    expect(seen.has("ghost")).toBe(true);
    expect(seen.has("real")).toBe(true);
  });

  it("terminates on a parentId CYCLE", () => {
    const all = [occ("a", { parentId: "b" }), occ("b", { parentId: "a" })];
    const seen = collectSubtreeIds({
      rootOccurrenceId: "a",
      index: occurrenceIndexFor(all),
    });
    expect([...seen].sort()).toEqual(["a", "b"]);
  });

  it("returns an empty set when there is no root and no folder", () => {
    const seen = collectSubtreeIds({
      rootOccurrenceId: null,
      index: occurrenceIndexFor([occ("x")]),
    });
    expect(seen.size).toBe(0);
  });
});
