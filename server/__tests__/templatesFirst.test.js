// A day stepped to during the load is cloned from a template; the templates must be in the first message, or a
// new day's Schedule waits for the whole catalogue (~2 minutes on a slow link, 2026-11-06).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { splitShownFirst, templateRootIds } from "../utils/splitFullState.js";

const mods = [
  { id: "mPanel", role: "panel" }, { id: "mPage", role: "page", kind: "board" },
  { id: "mCont", role: "container" }, { id: "mInst", role: "instance" },
];
const folders = [
  { id: "fTpl", name: "Templates", meta: { protected: true } },
  { id: "fSched", name: "Schedule", parentId: "fTpl" },
  { id: "fOther", name: "Boards" },
];
const occs = [
  { id: "panel", moduleId: "mPanel", occurrences: ["shown"] },
  { id: "shown", moduleId: "mPage", occurrences: [] },
  { id: "tplPage", moduleId: "mPage", parentId: "fSched", occurrences: ["tplCont"] },
  { id: "tplCont", moduleId: "mCont", occurrences: ["tplItem"] },
  { id: "tplItem", moduleId: "mInst" },
  { id: "otherPage", moduleId: "mPage", parentId: "fOther", occurrences: ["otherCont"] },
  { id: "otherCont", moduleId: "mCont" },
];

describe("templates go in the first message", () => {
  it("names the pages filed under the Templates folder and its subfolders, and no others", () => {
    expect(templateRootIds(occs, folders, "fTpl")).toEqual(["tplPage"]);
    expect(templateRootIds(occs, folders, null)).toEqual([]);
  });
  it("as roots, a template's whole subtree is kept while another unshown page's content still waits", () => {
    const roots = ["panel", "shown", ...templateRootIds(occs, folders, "fTpl")];
    const { core, deferred } = splitShownFirst(occs, mods, { shownRootIds: roots });
    const ids = core.map((o) => o.id);
    expect(ids).toEqual(expect.arrayContaining(["tplPage", "tplCont", "tplItem"]));
    expect(deferred.map((o) => o.id)).toEqual(["otherCont"]);
  });
  it("full_state passes them as kept roots (wiring)", () => {
    const src = fs.readFileSync(new URL("../socketHandlers/state.js", import.meta.url), "utf8");
    const block = src.slice(src.indexOf("const keepRootIds"), src.indexOf("const split = splitShownFirst"));
    expect(block).toMatch(/templateRootIds\(/);
    expect(src).toMatch(/splitShownFirst\(allGridOccs, gridModules, \{ shownRootIds: keepRootIds \}\)/);
  });
});
