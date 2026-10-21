import { describe, it, expect } from "vitest";
import { shelfBooks, shelfBoard } from "../services/vrShelf.js";

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

  it("a board shelf holds the board's rows; a row with a book file opens the file", () => {
    const g = grid();
    g.modulesById.mBook = { id: "mBook", role: "instance", label: "Book", fieldBindings: [{ fieldId: "files", role: "files" }] };
    g.modulesById.mBooks = { id: "mBooks", role: "container", kind: "board", label: "Books" };
    g.modulesById.mEpub = { id: "mEpub", role: "artifact", kind: "ebook", label: "x.epub" };
    g.modulesById.mImg = { id: "mImg", role: "artifact", kind: "image", label: "pic.png" };
    g.occurrencesById.books = { id: "books", moduleId: "mBooks", occurrences: ["zen", "dune", "zenCopy"] };
    g.occurrencesById.zen = { id: "zen", moduleId: "mBook", label: "The Way of Zen", fields: { files: { value: ["img", "epub"], main: "epub" } } };
    g.occurrencesById.zenCopy = { id: "zenCopy", moduleId: "mBook", label: "The Way of Zen", meta: { feedSourceId: "zen" } };
    g.occurrencesById.dune = { id: "dune", moduleId: "mBook", label: "Dune", fields: { files: { value: ["img"] } } };
    g.occurrencesById.epub = { id: "epub", moduleId: "mEpub" };
    g.occurrencesById.img = { id: "img", moduleId: "mImg" };
    const shelf = shelfBoard(g, "Books");
    expect(shelf.title).toBe("Books");
    expect(shelf.books.map((b) => [b.title, b.id, b.opens])).toEqual([["The Way of Zen", "epub", "file"], ["Dune", "dune", "row"]]);
    expect(shelfBoard(g, "books").board).toBe("books");   // by id too
    // a feed board's copies open their source
    g.occurrencesById.feed = { id: "feed", moduleId: "mBooks", label: "Feed", occurrences: ["zenCopy"] };
    expect(shelfBoard(g, "feed").books.map((b) => [b.id, b.rowId])).toEqual([["epub", "zen"]]);
    expect(shelfBoard(g, "Nope")).toBeNull();
  });
});
