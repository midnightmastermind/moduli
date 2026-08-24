// "One module, many occurrences" enforced at the clone site.
//
// APPLY_TEMPLATE minted a FRESH module for every clone, so `Day Page: Build`
// produced a new Journal / Notes / Tasks Completed module every morning —
// 924 modules across 198 signatures on the live grid that should be 198.
import { describe, it, expect } from "vitest";
import { pickReusableModuleId, stampCloneOrigin, CLONE_OF } from "../../../server/utils/cloneModuleReuse.js";

const SRC = "m-template-journal";
const srcMod = { id: SRC, label: "Journal", role: "container", kind: "doc", meta: { templateModule: true } };
const clone = (id, over = {}) => ({ id, label: "Journal", role: "container", kind: "doc",
                                    meta: { [CLONE_OF]: SRC }, ...over });
const index = (...m) => Object.fromEntries(m.map((x) => [x.id, x]));

describe("pickReusableModuleId", () => {
  it("returns null on the FIRST apply — there is nothing to reuse yet", () => {
    expect(pickReusableModuleId({ modulesById: index(srcMod), srcModId: SRC, srcMod })).toBeNull();
  });

  it("reuses the module a previous apply minted", () => {
    const mods = index(srcMod, clone("m-day1"));
    expect(pickReusableModuleId({ modulesById: mods, srcModId: SRC, srcMod })).toBe("m-day1");
  });

  it("NEVER reuses the template itself", () => {
    // Pointing a clone at the source would place the template. The stamp is what
    // distinguishes an apply from the thing applied.
    const selfStamped = { ...srcMod, meta: { ...srcMod.meta, [CLONE_OF]: SRC } };
    expect(pickReusableModuleId({ modulesById: index(selfStamped), srcModId: SRC, srcMod })).toBeNull();
  });

  it("ignores a clone of a DIFFERENT template node", () => {
    const other = clone("m-other", { meta: { [CLONE_OF]: "m-template-notes" } });
    expect(pickReusableModuleId({ modulesById: index(srcMod, other), srcModId: SRC, srcMod })).toBeNull();
  });

  it("does not adopt a clone somebody has RENAMED", () => {
    // The stamp alone is not enough — a renamed clone is no longer the same
    // thing, and re-pointing new placements at it would silently adopt an edit.
    const renamed = clone("m-day1", { label: "My Journal" });
    expect(pickReusableModuleId({ modulesById: index(srcMod, renamed), srcModId: SRC, srcMod })).toBeNull();
  });

  it("does not adopt a clone whose ROLE or KIND has changed", () => {
    expect(pickReusableModuleId({ modulesById: index(srcMod, clone("a", { kind: "board" })), srcModId: SRC, srcMod })).toBeNull();
    expect(pickReusableModuleId({ modulesById: index(srcMod, clone("b", { role: "instance" })), srcModId: SRC, srcMod })).toBeNull();
  });

  it("skips a TRASHED clone", () => {
    expect(pickReusableModuleId({ modulesById: index(srcMod, clone("m-day1", { trashed: true })), srcModId: SRC, srcMod })).toBeNull();
  });

  it("NEVER shares a root that carries its own label", () => {
    // `rootLabel` renames the root per apply ("Day Page - 2026-08-23"), so
    // sharing one would give every day column the same name.
    const mods = index(srcMod, clone("m-day1"));
    expect(pickReusableModuleId({ modulesById: mods, srcModId: SRC, srcMod, isRoot: true, rootLabelOverride: "Day Page - 2026-08-24" })).toBeNull();
  });

  it("DOES share a root with no label override", () => {
    const mods = index(srcMod, clone("m-day1"));
    expect(pickReusableModuleId({ modulesById: mods, srcModId: SRC, srcMod, isRoot: true, rootLabelOverride: null })).toBe("m-day1");
  });

  it("survives a missing source or empty index", () => {
    expect(pickReusableModuleId({ modulesById: {}, srcModId: SRC, srcMod })).toBeNull();
    expect(pickReusableModuleId({ modulesById: index(srcMod), srcModId: null, srcMod })).toBeNull();
    expect(pickReusableModuleId({})).toBeNull();
  });
});

describe("stampCloneOrigin", () => {
  it("records which template node this module is an apply of", () => {
    expect(stampCloneOrigin({ templateModule: false }, SRC))
      .toEqual({ templateModule: false, [CLONE_OF]: SRC });
  });

  it("keeps every other meta key", () => {
    expect(stampCloneOrigin({ a: 1, b: 2 }, SRC).a).toBe(1);
  });

  it("is a no-op without a source id", () => {
    expect(stampCloneOrigin({ a: 1 }, null)).toEqual({ a: 1 });
  });
});
