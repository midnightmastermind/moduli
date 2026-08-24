// 0226 — the decisions in "put the books in a books section", driven dry.
import { describe, it, expect } from "vitest";
import { planAuthors, readTagOptions } from "../migrations/0226-book-library.mjs";

describe("planAuthors — who gets an Author row, and who gets none", () => {
  const works = [
    { title: "The Way of Zen", author: "Alan Watts" },
    { title: "Tao: The Watercourse Way", author: "Alan Watts" },
    { title: "Dune", author: "Frank Herbert" },
    { title: "WithEachAndEveryBreath", author: "" },
    { title: "Write Great Code", author: "" },
  ];

  it("mints ONE author row per distinct author, however many books they wrote", () => {
    const { authors, byAuthor } = planAuthors(works);
    expect(authors).toEqual(["Alan Watts", "Frank Herbert"]);
    expect(byAuthor.get("Alan Watts")).toHaveLength(2);
  });

  it("leaves a book with NO author unlinked rather than guessing one", () => {
    // 127 of the 665 works have no author in the catalogue and none recoverable
    // from the filename. A plausible author on a book you own is
    // indistinguishable from one you set yourself.
    const { unlinked, authors } = planAuthors(works);
    expect(unlinked).toBe(2);
    expect(authors).not.toContain("");
  });

  it("does not create an author row from whitespace", () => {
    expect(planAuthors([{ title: "x", author: "   " }]).authors).toEqual([]);
  });

  it("is stable in ORDER, so a re-run mints the same rows", () => {
    expect(planAuthors(works).authors).toEqual(planAuthors([...works].reverse()).authors);
  });

  it("survives an empty or absent survey rather than throwing", () => {
    expect(planAuthors([]).authors).toEqual([]);
    expect(planAuthors(undefined).authors).toEqual([]);
  });
});

describe("readTagOptions — the two places Board Category keeps its options", () => {
  it("prefers optionsSource.values, the shape poms grid uses", () => {
    const r = readTagOptions({ meta: { optionsSource: { values: ["song"] }, options: ["stale"] } });
    expect(r).toEqual({ path: "meta.optionsSource.values", values: ["song"] });
  });

  it("falls back to meta.options, the shape a seeded grid uses", () => {
    // Writing the wrong key leaves a one-element list on a field whose real
    // options live elsewhere — `0054` shipped exactly that.
    expect(readTagOptions({ meta: { options: ["song"] } }).path).toBe("meta.options");
  });

  it("returns an empty list for a field with neither, so the caller can add", () => {
    expect(readTagOptions({}).values).toEqual([]);
    expect(readTagOptions(null).values).toEqual([]);
  });
});
