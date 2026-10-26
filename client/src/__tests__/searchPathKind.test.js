import { describe, it, expect } from "vitest";
import { buildSearchIndex, searchOccurrences, kindLabel } from "../helpers/occurrenceSearch.js";

const modulesById = {
  pg: { id: "pg", role: "page", kind: "board", label: "Lookup" },
  ct: { id: "ct", role: "container", kind: "board", label: "Lookup" },
  pg2: { id: "pg2", role: "page", kind: "doc", label: "lookup notes" },
  ct2: { id: "ct2", role: "container", kind: "doc", label: "Catch-All" },
  row: { id: "row", role: "textblock", kind: "doc", label: "" },
};
const occurrencesById = {
  page: { id: "page", moduleId: "pg", parentId: "fNotes", occurrences: ["board"] },
  board: { id: "board", moduleId: "ct", parentId: "page", occurrences: ["r1"] },
  r1: { id: "r1", moduleId: "row", parentId: "board", label: "lookup this" },
  page2: { id: "page2", moduleId: "pg2", parentId: "fNotes", occurrences: ["doc2"] },
  doc2: { id: "doc2", moduleId: "ct2", parentId: "page2", occurrences: [] },
};
const foldersById = { root: { id: "root", name: "Root", parentId: null }, docs: { id: "docs", name: "Documents", parentId: "root" }, fNotes: { id: "fNotes", name: "Notes", parentId: "docs" } };

describe("search results", () => {
  const index = buildSearchIndex({ occurrencesById, modulesById, foldersById });
  const hits = searchOccurrences(index, "lookup").results.map((h) => h.entry);
  it("a path starts at Root, through the folders", () => {
    expect(hits.find((e) => e.occId === "page").pathLabels).toEqual(["Root", "Documents", "Notes"]);
    expect(hits.find((e) => e.occId === "r1").pathLabels).toEqual(["Root", "Documents", "Notes", "Lookup", "Lookup"]);
  });
  it("the one board on a page with the page's own name is listed once (as the page)", () => {
    expect(hits.map((e) => e.occId)).not.toContain("board");
    expect(hits.map((e) => e.occId)).toContain("page");
  });
  it("a differently named board on a page is still listed (control)", () => {
    const h = searchOccurrences(index, "catch").results.map((x) => x.entry.occId);
    expect(h).toContain("doc2");
  });
  it("says what kind of thing each result is", () => {
    expect(hits.find((e) => e.occId === "page").kindLabel).toBe("Board page");
    expect(hits.find((e) => e.occId === "r1").kindLabel).toBe("Text block");
    expect(kindLabel("artifact", "bookmark")).toBe("Bookmark");
    expect(kindLabel("page", "folder")).toBe("Folder");
  });
});
