// The first message carries the shown pages; pages pinned to a panel but not shown follow (user, 2026-11-03).
import { describe, it, expect } from "vitest";
import { splitShownFirst } from "../utils/splitFullState.js";
import { chunkBySize } from "../socketHandlers/state.js";

const mods = [
  { id: "mPanel", role: "panel" }, { id: "mPage", role: "page", kind: "board" }, { id: "mFolderPage", role: "page", kind: "folder" },
  { id: "mCont", role: "container" }, { id: "mInst", role: "instance" }, { id: "mHiddenInst", role: "instance" },
  { id: "mOpt", role: "instance" }, { id: "mArt", role: "artifact" },
];
const occs = [
  { id: "panel", moduleId: "mPanel", occurrences: ["shown", "hidden"] },
  { id: "shown", moduleId: "mPage", occurrences: ["c1"] },
  { id: "c1", moduleId: "mCont", occurrences: ["i1"] },
  { id: "i1", moduleId: "mInst", fields: { f: { value: "opt" }, g: { value: ["opt2"] } } },
  { id: "hidden", moduleId: "mPage", occurrences: ["c2"] },
  { id: "c2", moduleId: "mCont", occurrences: ["i2"] },
  { id: "i2", moduleId: "mHiddenInst" },
  { id: "opt", moduleId: "mOpt", occurrences: ["optChild"] },
  { id: "optChild", moduleId: "mInst" },
  { id: "opt2", moduleId: "mOpt" },
  { id: "folder", moduleId: "mFolderPage", occurrences: ["card"] },
  { id: "card", moduleId: "mPage", occurrences: ["cardCont"] },
  { id: "cardCont", moduleId: "mCont" },
  { id: "loose", moduleId: "mArt" },
];
const ids = (a) => a.map((o) => o.id).sort();

describe("splitShownFirst", () => {
  const { core, deferred, coreModules, deferredModules } = splitShownFirst(occs, mods, { shownRootIds: ["panel", "shown"] });

  it("keeps everything under the shown page", () => {
    expect(ids(core)).toEqual(expect.arrayContaining(["panel", "shown", "c1", "i1"]));
  });
  it("keeps a pinned-but-not-shown page's ROW, and sends its content later", () => {
    expect(ids(core)).toContain("hidden");
    expect(ids(deferred)).toEqual(expect.arrayContaining(["c2", "i2"]));
  });
  it("keeps the rows a shown row's field points to, one hop only", () => {
    expect(ids(core)).toEqual(expect.arrayContaining(["opt", "opt2"]));
    expect(ids(deferred)).toContain("optChild");
  });
  it("keeps every page row, and a folder page's card rows but not below them", () => {
    const { core: c2, deferred: d2 } = splitShownFirst(occs, mods, { shownRootIds: ["panel", "folder"] });
    expect(ids(c2)).toEqual(expect.arrayContaining(["folder", "card"]));
    expect(ids(d2)).toContain("cardCont");
  });
  it("sends a module later only when no kept row uses it", () => {
    expect(coreModules.map((m) => m.id)).toContain("mInst");
    expect(deferredModules.map((m) => m.id)).toEqual(expect.arrayContaining(["mHiddenInst", "mArt"]));
  });
  it("loses nothing", () => {
    expect(core.length + deferred.length).toBe(occs.length);
    expect(coreModules.length + deferredModules.length).toBe(mods.length);
  });
});

describe("chunkBySize", () => {
  it("cuts at the size limit and never returns an empty chunk", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: String(i), pad: "x".repeat(100) }));
    const chunks = chunkBySize(rows, 350);
    expect(chunks.flat().length).toBe(10);
    expect(chunks.every((c) => c.length > 0 && JSON.stringify(c).length < 500)).toBe(true);
  });
  it("puts a row bigger than the limit in its own chunk", () => {
    expect(chunkBySize([{ big: "x".repeat(1000) }, { s: 1 }], 100)).toHaveLength(2);
  });
});
