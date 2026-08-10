// 0063 DELETES occurrences on protected live data, so the tests are about the
// predicate: what it selects, and — more importantly — what it must not.
import { describe, it, expect } from "vitest";
import { findOrphanFeedCopies, findFeedDonor } from "../migrations/0063-orphan-feed-clones.mjs";

const copy = (id, parentSrc = "src-1") => ({ id, moduleId: `m-${id}`, meta: { feedSourceId: parentSrc } });
const plain = (id) => ({ id, moduleId: `m-${id}`, meta: {} });

describe("0063 findOrphanFeedCopies", () => {
  it("selects a feed copy whose parent has NO feed", () => {
    const world = [
      { id: "wheel", identitySignature: "sig", occurrences: ["c1", "c2"] },  // no feed
      copy("c1"), copy("c2"),
    ];
    const groups = findOrphanFeedCopies(world);
    expect([...groups.values()][0].orphans.map((o) => o.id)).toEqual(["c1", "c2"]);
  });

  it("LEAVES a feed copy whose parent HAS a feed — feedSync owns it", () => {
    // The discriminating case. 284 feed copies on the live grid are exactly
    // this, and deleting them would destroy live data.
    const world = [
      { id: "wheel", feed: { enabled: true }, occurrences: ["c1"] },
      copy("c1"),
    ];
    expect(findOrphanFeedCopies(world).size).toBe(0);
  });

  it("LEAVES a hand-placed child — no feedSourceId, not derived data", () => {
    const world = [{ id: "box", occurrences: ["p1"] }, plain("p1")];
    expect(findOrphanFeedCopies(world).size).toBe(0);
  });

  it("groups orphans by their parent, so each container is reported separately", () => {
    const world = [
      { id: "a", occurrences: ["c1"] }, { id: "b", occurrences: ["c2", "c3"] },
      copy("c1"), copy("c2"), copy("c3"),
    ];
    const groups = findOrphanFeedCopies(world);
    expect(groups.size).toBe(2);
    expect(groups.get("a").orphans).toHaveLength(1);
    expect(groups.get("b").orphans).toHaveLength(2);
  });

  it("catches a parentless feed copy too — nothing can ever sweep it", () => {
    const world = [copy("loose")];
    expect([...findOrphanFeedCopies(world).values()][0].orphans.map((o) => o.id)).toEqual(["loose"]);
  });

  it("reads the parent from occurrences[], which is what feedSync and the renderer use", () => {
    // parentId alone is not the relationship here: a fed child is listed by its
    // owner, and the owner is what carries the feed.
    const world = [
      { id: "wheel", feed: { enabled: true }, occurrences: ["c1"] },
      { ...copy("c1"), parentId: "somewhere-else" },
    ];
    expect(findOrphanFeedCopies(world).size).toBe(0);
  });
});

describe("0063 findFeedDonor", () => {
  const donor = { id: "tpl-wheel", identitySignature: "daypage:Emotions Wheel", feed: { enabled: true, limit: 1000 } };

  it("finds a same-signature occurrence that carries a feed", () => {
    const parent = { id: "col-wheel", identitySignature: "daypage:Emotions Wheel" };
    expect(findFeedDonor([donor, parent], parent)).toBe(donor);
  });

  it("never returns the parent itself", () => {
    const parent = { id: "col-wheel", identitySignature: "sig", feed: { enabled: true } };
    expect(findFeedDonor([parent], parent)).toBeNull();
  });

  it("returns null when no same-signature occurrence has a feed — the caller then KEEPS the rows", () => {
    // Deleting the rows and leaving a permanently empty container behind is a
    // worse outcome than the duplication being cleaned up.
    const parent = { id: "col-wheel", identitySignature: "sig" };
    const sibling = { id: "other", identitySignature: "sig" };   // no feed
    expect(findFeedDonor([sibling, parent], parent)).toBeNull();
  });

  it("returns null for an unsigned parent rather than matching on anything else", () => {
    const parent = { id: "col-wheel" };
    expect(findFeedDonor([donor, parent], parent)).toBeNull();
  });
});
