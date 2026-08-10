// `_ancestors` on freshly-cloned stubs. The behavioral suite proves the
// end-to-end symptom (a built day column's question never filled); these pin
// the part that is easy to break silently — a CHILD is stubbed BEFORE its
// PARENT, so the chain has to be resolved after the walk, not during it.
import { describe, it, expect } from "vitest";
import { stampCloneAncestors } from "../helpers/operationActions";

describe("stampCloneAncestors", () => {
  it("resolves a chain that runs through a parent stubbed LATER", () => {
    // Depth-first clone order: leaves first, roots last. The child is stamped
    // from a parent that does not exist yet in the world — only as a sibling
    // stub — which is the whole reason this runs as a second pass.
    const stubs = [
      { id: "c-question", parentId: "c-journal" },   // leaf, stubbed first
      { id: "c-journal", parentId: "c-col" },
      { id: "c-col", parentId: "board" },            // root, stubbed last
    ];
    stampCloneAncestors(stubs, { board: { id: "board", parentId: null } });
    expect(stubs[0]._ancestors).toEqual(["c-journal", "c-col", "board"]);
    expect(stubs[1]._ancestors).toEqual(["c-col", "board"]);
    expect(stubs[2]._ancestors).toEqual(["board"]);
  });

  it("reaches PAST the new subtree into the existing tree above it", () => {
    // The discriminating case for the bug this fixes: the FIND that failed
    // asked `_ancestors HAS_ANCESTOR $colId` where the column is real, existing
    // world — a walk that stopped at the clone boundary would not contain it.
    const stubs = [{ id: "clone", parentId: "real-col" }];
    stampCloneAncestors(stubs, {
      "real-col": { id: "real-col", parentId: "real-board" },
      "real-board": { id: "real-board", parentId: null },
    });
    expect(stubs[0]._ancestors).toContain("real-col");
    expect(stubs[0]._ancestors).toEqual(["real-col", "real-board"]);
  });

  it("mutates IN PLACE, because the stubs were published into $vars by reference", () => {
    const stub = { id: "a", parentId: "p" };
    const published = [stub];                       // what $allItems holds
    stampCloneAncestors([stub], { p: { id: "p" } });
    expect(published[0]._ancestors).toEqual(["p"]);  // same object, enriched
  });

  it("gives a root clone an EMPTY chain rather than throwing", () => {
    // A clone rooted at a folder names a parent that is not an occurrence.
    // That is the normal case, not an error.
    const stubs = [{ id: "a", parentId: null }, { id: "b", parentId: "not-an-occ" }];
    stampCloneAncestors(stubs, {});
    expect(stubs[0]._ancestors).toEqual([]);
    expect(stubs[1]._ancestors).toEqual(["not-an-occ"]);
  });

  it("survives a cycle instead of hanging", () => {
    const stubs = [{ id: "x", parentId: "y" }, { id: "y", parentId: "x" }];
    stampCloneAncestors(stubs, {});
    expect(Array.isArray(stubs[0]._ancestors)).toBe(true);
    expect(stubs[0]._ancestors.length).toBeLessThan(64);
  });

  it("is a no-op on an empty or absent stub list", () => {
    expect(() => stampCloneAncestors([], {})).not.toThrow();
    expect(() => stampCloneAncestors(null, {})).not.toThrow();
  });
});
