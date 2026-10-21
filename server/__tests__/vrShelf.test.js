import { describe, it, expect } from "vitest";
import { shelfBooks, pageReadable } from "../services/vrShelf.js";

const p = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
function grid() {
  const modulesById = {
    mPage: { id: "mPage", role: "page", kind: "doc", label: "Notes" },
    mBoard: { id: "mBoard", role: "page", kind: "board", label: "Tasks" },
    mFolder: { id: "mFolder", role: "page", kind: "folder", label: "Files" },
    mTpl: { id: "mTpl", role: "page", kind: "doc", label: "Day Page Template" },
    mSec: { id: "mSec", role: "container", kind: "doc", label: "Intro" },
    mTb: { id: "mTb", role: "textblock", kind: "doc" },
    mRow: { id: "mRow", role: "instance", label: "Email Sam" },
    mCol: { id: "mCol", role: "container", kind: "board", label: "Today" },
  };
  const occurrencesById = {
    page: { id: "page", moduleId: "mPage", updatedAt: "2026-10-02", textmap: { type: "doc", content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Hello" }] },
      p("First line."),
      { type: "moduleEmbed", attrs: { occurrenceId: "sec" } },
    ] } },
    sec: { id: "sec", moduleId: "mSec", parentId: "page", textmap: { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "tb" } }] }, occurrences: ["tb"] },
    tb: { id: "tb", moduleId: "mTb", parentId: "sec", textmap: { type: "doc", content: [p("Inside a section.")] } },
    board: { id: "board", moduleId: "mBoard", updatedAt: "2026-10-05", occurrences: ["col"] },
    col: { id: "col", moduleId: "mCol", parentId: "board", occurrences: ["row"] },
    row: { id: "row", moduleId: "mRow", parentId: "col" },
    folderPage: { id: "folderPage", moduleId: "mFolder" },
    tpl: { id: "tpl", moduleId: "mTpl", parentId: "tplFolder" },
  };
  const foldersById = { tplFolder: { id: "tplFolder", name: "Templates", meta: { protected: true } } };
  return { modulesById, occurrencesById, foldersById };
}

describe("vrShelf", () => {
  it("lists pages newest first, without folder pages or templates", () => {
    const { books, total } = shelfBooks(grid());
    expect(books.map((b) => b.title)).toEqual(["Tasks", "Notes"]);
    expect(total).toBe(2);
  });

  it("flattens a doc page through its embedded sections", () => {
    const r = pageReadable(grid(), "page");
    expect(r.title).toBe("Notes");
    expect(r.blocks).toEqual([
      { type: "heading", level: 1, text: "Hello" },
      { type: "text", text: "First line." },
      { type: "heading", level: 2, text: "Intro" },
      { type: "text", text: "Inside a section." },
    ]);
  });

  it("reads a board page's containers and rows", () => {
    const r = pageReadable(grid(), "board");
    expect(r.blocks).toEqual([
      { type: "heading", level: 2, text: "Today" },
      { type: "item", text: "Email Sam" },
    ]);
  });

  it("returns null for a page that is not there", () => {
    expect(pageReadable(grid(), "nope")).toBeNull();
  });
});
