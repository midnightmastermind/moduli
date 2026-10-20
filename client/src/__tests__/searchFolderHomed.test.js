// UI sweep 2026-10-19: a Wikipedia import filed into a FOLDER (rebuild grid, Library/Reading ›
// Noam Chomsky) has no page above it — it shows as a card on the folder's page. Search listed every
// row of it as "not on a page" and a pick opened nothing.
import { describe, it, expect } from "vitest";
import { folderHomeOf } from "../helpers/openOccurrenceInPanel";
import { buildSearchIndex } from "../helpers/occurrenceSearch";

const occurrencesById = {
  fp:   { id: "fp", moduleId: "mfp", parentId: "folderR", meta: { folderPage: true } },
  art:  { id: "art", moduleId: "mart", parentId: "folderR", occurrences: ["sec"] },
  sec:  { id: "sec", moduleId: "msec", parentId: "art", occurrences: ["tb"] },
  tb:   { id: "tb", moduleId: "mtb", parentId: "sec" },
  lost: { id: "lost", moduleId: "mtb", parentId: null },
  loose:{ id: "loose", moduleId: "mtb", parentId: "folderNoPage" },
  page: { id: "page", moduleId: "mpage", parentId: "folderR", meta: {}, occurrences: ["row"] },
  row:  { id: "row", moduleId: "mtb", parentId: "page" },
};
const modulesById = {
  mfp: { id: "mfp", role: "page", kind: "folder", label: "Reading" },
  mart: { id: "mart", role: "container", kind: "doc", label: "Noam Chomsky" },
  msec: { id: "msec", role: "container", kind: "doc", label: "Life" },
  mtb: { id: "mtb", role: "textblock", label: "" },
  mpage: { id: "mpage", role: "page", kind: "board", label: "Board" },
};

describe("folderHomeOf", () => {
  it("names the card at the top of the chain and the folder page that shows it", () => {
    expect(folderHomeOf("tb", { occurrencesById })).toEqual({ rootOccId: "art", folderPageOccId: "fp" });
    expect(folderHomeOf("art", { occurrencesById })).toEqual({ rootOccId: "art", folderPageOccId: "fp" });
  });
  it("is null when the chain ends nowhere, or in a folder with no page", () => {
    expect(folderHomeOf("lost", { occurrencesById })).toBe(null);
    expect(folderHomeOf("loose", { occurrencesById })).toBe(null);
  });
  it("never answers with the folder page itself", () => {
    expect(folderHomeOf("fp", { occurrencesById })).toBe(null);
  });
});

describe("search index", () => {
  const idx = buildSearchIndex({ occurrencesById, modulesById });
  const entry = (id) => idx.entries.find((e) => e.occId === id);
  it("a row inside a folder-homed card is reachable through the folder page", () => {
    expect(entry("art").pageOccId).toBe("fp");
    expect(entry("sec").pageOccId).toBe("fp");
  });
  it("a row on a real page keeps its page; an unlisted row stays unreachable", () => {
    expect(entry("row").pageOccId).toBe("page");
    expect(entry("lost")?.pageOccId ?? null).toBe(null);
  });
});

import fs from "node:fs";
import path from "node:path";
describe("panel search pick", () => {
  it("falls back to the folder page drilled into the card", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../modules/ModulePanel.jsx"), "utf8");
    const at = src.indexOf("const handleSearchPick");
    const body = src.slice(at, src.indexOf("}, [", at));
    expect(body).toMatch(/folderHomeOf\(occId/);
    expect(body).toMatch(/openPage\(home\.folderPageOccId, \{ drilldownTarget: home\.rootOccId \}\)/);
  });
});
