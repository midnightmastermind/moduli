import { describe, it, expect } from "vitest";
import { planCleanup, extOf } from "../migrations/0411-books-cleanup.mjs";

const row = (id, label, libs = [], exts = [], fields = {}) => ({ id, label, libs, files: exts.map((ext, i) => ({ occId: `${id}-f${i}`, ext })), fields });

describe("0411 planCleanup", () => {
  it("deletes a Calibre-only row with no file, keeps one with a file and a mixed-source row", () => {
    const { deletes } = planCleanup([
      row("a", "Myth and religion", ["c_calibre"]),
      row("b", "Tao: The Watercourse Way", ["d_calibre"], ["epub"]),
      row("c", "Some Book", ["big_books", "c_calibre"]),
    ]);
    expect([...deletes.keys()]).toEqual(["a"]);
  });

  it("deletes the personal documents by name, not books", () => {
    const { deletes } = planCleanup([row("p", "resume 2025", ["c_loose"]), row("q", "portugal: hotel: booking", ["c_loose"]), row("r", "Basic Portuguese", ["c_loose"])]);
    expect([...deletes.keys()].sort()).toEqual(["p", "q"]);
  });

  it("merges a duplicate group into the row with the better file", () => {
    const { merges } = planCleanup([
      row("x", "Interface", [], ["azw"]),
      row("y", "Interface: A Novel", ["big_books"], ["epub"]),
    ]);
    expect(merges).toEqual([{ keepId: "y", label: "Interface", dropIds: ["x"] }]);
  });

  it("on equal files keeps the fuller row; a row already being deleted is not merged", () => {
    const full = { f1: { value: 1 }, f2: { value: "x" } };
    const { merges } = planCleanup([
      row("m1", "The Manga Guide to Physics", ["d_calibre"], ["epub"]),
      row("m2", "Manga Guide to Physics, The", [], ["epub"], full),
      row("g1", "Gods of Risk", ["c_calibre"]),
    ]);
    expect(merges).toEqual([{ keepId: "m2", label: "The Manga Guide to Physics", dropIds: ["m1"] }]);
  });

  it("extOf reads a file extension", () => {
    expect(extOf("A Book_KEY.epub")).toBe("epub");
    expect(extOf("x")).toBe("");
  });
});
