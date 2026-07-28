// __tests__/protectedGrids.test.js
//
// The protected-grid rule is the thing standing between a routine reseed and
// the live data, so it gets tested as a contract rather than as an
// implementation detail: name matching, the rename-proof meta stamp, and the
// filter helpers the whole-user wipe scripts depend on.
import { describe, it, expect } from "vitest";
import {
  PROTECTED_GRID_NAMES,
  isProtectedGridName,
  isProtectedGrid,
  assertNotProtected,
  partitionProtected,
  withProtectedExcluded,
} from "../utils/protectedGrids.js";

describe("the protected list", () => {
  it("holds the live grid and the frozen old one", () => {
    expect(PROTECTED_GRID_NAMES).toContain("poms grid");
    expect(PROTECTED_GRID_NAMES).toContain("test grid 1");
  });

  it("does NOT hold the seed's target — that one is meant to be overwritten", () => {
    expect(PROTECTED_GRID_NAMES).not.toContain("test grid 2");
    expect(isProtectedGridName("test grid 2")).toBe(false);
  });

  it("is frozen, so nothing can push onto it at runtime", () => {
    expect(Object.isFrozen(PROTECTED_GRID_NAMES)).toBe(true);
  });
});

describe("isProtectedGridName", () => {
  it("matches case-insensitively and ignores surrounding space", () => {
    expect(isProtectedGridName("Poms Grid")).toBe(true);
    expect(isProtectedGridName("  poms grid  ")).toBe(true);
    expect(isProtectedGridName("POMS GRID")).toBe(true);
  });

  it("does not match a near-miss name", () => {
    expect(isProtectedGridName("poms")).toBe(false);
    expect(isProtectedGridName("poms grid backup")).toBe(false);
    expect(isProtectedGridName("")).toBe(false);
    expect(isProtectedGridName(null)).toBe(false);
  });
});

describe("isProtectedGrid", () => {
  it("protects by name", () => {
    expect(isProtectedGrid({ name: "poms grid" })).toBe(true);
  });

  it("protects by the meta stamp even when the grid was RENAMED", () => {
    // The stamp is the rename-proof half: someone renaming the live grid must
    // not thereby make it deletable.
    expect(isProtectedGrid({ name: "something else", meta: { protected: true } })).toBe(true);
  });

  it("leaves an ordinary grid alone", () => {
    expect(isProtectedGrid({ name: "test grid 2" })).toBe(false);
    expect(isProtectedGrid({ name: "test grid 2", meta: {} })).toBe(false);
    expect(isProtectedGrid(null)).toBe(false);
  });
});

describe("assertNotProtected", () => {
  it("THROWS rather than returning false — a boolean someone forgets to check is not a guard", () => {
    expect(() => assertNotProtected("poms grid", "drop")).toThrow(/Refusing to drop "poms grid"/);
    expect(() => assertNotProtected({ name: "x", meta: { protected: true } }, "clear"))
      .toThrow(/Refusing to clear/);
  });

  it("names the alternative in the message so the reader knows what to do instead", () => {
    expect(() => assertNotProtected("poms grid", "drop")).toThrow(/backupGrid|migration/);
  });

  it("is a no-op for an unprotected grid", () => {
    expect(() => assertNotProtected("test grid 2", "drop")).not.toThrow();
    expect(() => assertNotProtected({ name: "scratch" }, "drop")).not.toThrow();
  });
});

describe("partitionProtected", () => {
  it("splits a grid list into safe and protected", () => {
    const { safe, protected: keep } = partitionProtected([
      { _id: "1", name: "test grid 2" },
      { _id: "2", name: "poms grid" },
      { _id: "3", name: "scratch", meta: { protected: true } },
      { _id: "4", name: "" },
    ]);
    expect(safe.map(g => g._id)).toEqual(["1", "4"]);
    expect(keep.map(g => g._id)).toEqual(["2", "3"]);
  });
});

describe("withProtectedExcluded", () => {
  it("passes the filter straight through when nothing is protected", () => {
    const f = { userId: "u1" };
    expect(withProtectedExcluded(f, [])).toBe(f);
  });

  it("ANDs a gridId exclusion onto the base filter", () => {
    expect(withProtectedExcluded({ userId: "u1" }, ["g1", "g2"])).toEqual({
      $and: [{ userId: "u1" }, { gridId: { $nin: ["g1", "g2"] } }],
    });
  });

  it("preserves a compound base filter instead of overwriting its keys", () => {
    // resetData/clearUserData pass a codex-preserve filter — the exclusion must
    // narrow it, not replace it.
    const base = { userId: "u1", "meta.source": { $ne: "codex-import" } };
    const out = withProtectedExcluded(base, ["g1"]);
    expect(out.$and[0]).toEqual(base);
    expect(out.$and[1]).toEqual({ gridId: { $nin: ["g1"] } });
  });
});
