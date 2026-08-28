// __tests__/folderPageCards.test.js — 0272
//
// A sub-folder renders on its parent's folder PAGE only if it contains a
// `role:"page" kind:"folder"` occurrence — that occurrence IS the card. The
// sidebar reads `foldersById` directly, so the tree shows every folder while the
// page shows only carded ones, which is why this reads as data loss.
//
// Measured on poms grid 2026-08-28: 68 folders, 37 carded, 31 not — including
// "Documents" (holds Notes + Codex, page showed 0), the user's report.
import { describe, it, expect } from "vitest";
import { planFolderPages } from "../migrations/0272-missing-folder-page-occurrences.mjs";

const folder = (id, name, extra = {}) => ({ id, name, ...extra });
const cardFor = (folderId) => ({ id: `occ-${folderId}`, parentId: folderId, moduleId: `mod-${folderId}` });
const MODS = (ids) => Object.fromEntries(ids.map(i => [`mod-${i}`, { role: "page", kind: "folder" }]));

describe("planFolderPages", () => {
  it("names a folder that has no card", () => {
    const plan = planFolderPages([folder("f1", "Documents")], [], {});
    expect(plan).toEqual([{ folderId: "f1", label: "Documents" }]);
  });

  it("skips one that already has a card — idempotent, so a re-run mints nothing", () => {
    const plan = planFolderPages([folder("f1", "Documents")], [cardFor("f1")], MODS(["f1"]));
    expect(plan).toEqual([]);
  });

  it("USES THE RENDERER'S TEST, not `meta.folderPage`", () => {
    // `ensureFolderPageOcc` identifies a card by `meta.folderPage === true`;
    // the renderer identifies it by the MODULE's kind+role. Minting off the
    // helper's test would DUPLICATE a card for any folder whose occurrence
    // lacks the flag — this occurrence has no flag and must still count.
    const occ = { id: "o1", parentId: "f1", moduleId: "mod-f1" };   // no meta
    expect(planFolderPages([folder("f1", "Docs")], [occ], MODS(["f1"]))).toEqual([]);
  });

  it("an occurrence of the WRONG kind is not a card", () => {
    const occ = { id: "o1", parentId: "f1", moduleId: "m" };
    const mods = { m: { role: "page", kind: "board" } };   // a board page, not a folder card
    expect(planFolderPages([folder("f1", "Docs")], [occ], mods)).toHaveLength(1);
  });

  it("a `category` folder is never a card — the same exemption ModulePage makes", () => {
    const plan = planFolderPages([folder("f1", "Ops", { folderType: "category" })], [], {});
    expect(plan).toEqual([]);
  });

  it("falls back to a label rather than minting a nameless card", () => {
    expect(planFolderPages([{ id: "f1" }], [], {})[0].label).toBe("Folder");
  });

  it("THE SHAPE THAT PROMPTED THIS: a parent carded, its children not", () => {
    // "Documents" has a card, so it shows on Root — but Notes and Codex have
    // none, so opening Documents renders an empty page and its PREVIEW is blank.
    const folders = [folder("docs", "Documents"), folder("notes", "Notes", { parentId: "docs" }),
                     folder("codex", "Codex", { parentId: "docs" })];
    const plan = planFolderPages(folders, [cardFor("docs")], MODS(["docs"]));
    expect(plan.map(p => p.label).sort()).toEqual(["Codex", "Notes"]);
  });
});
