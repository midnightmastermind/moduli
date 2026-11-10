// server/__tests__/boardMatch.test.js — plan Task 6: a typed page takes the row shape of its board.
import { describe, it, expect } from "vitest";
import { matchBoard, pickBoardForType, structuredFieldValues } from "../services/boardMatch.js";

// Shaped like poms grid's destinations: Movies (993 rows tagged movie), a small second movie board, Books.
const DESTS = [
  { id: "o-movies", label: "Movies", childCount: 993, shape: { moduleId: "m-movie", bindFields: ["f-year", "f-cat", "f-title"], autoFields: { "f-cat": ["movie"] } } },
  { id: "o-watch", label: "Watchlist", childCount: 4, shape: { moduleId: "m-w", bindFields: ["f-cat"], autoFields: { "f-cat": ["movie"] } } },
  { id: "o-books", label: "Books", childCount: 480, shape: { moduleId: "m-book", bindFields: ["f-cat"], autoFields: { "f-cat": "book" } } },
  { id: "o-schedule", label: "Schedule", childCount: 49, shape: null },
];
const FIELDS = [
  { id: "f-year", name: "Year", type: "number" }, { id: "f-cat", name: "Board Category", type: "select" },
  { id: "f-title", name: "Title", type: "text" }, { id: "f-auth", name: "Author", type: "occurrence" },
];

describe("matchBoard", () => {
  const deps = {
    searchDestinations: async () => DESTS,
    fieldsFor: async (ids) => FIELDS.filter((f) => ids.includes(f.id)),
    moduleFor: async () => ({ fieldBindings: [{ fieldId: "f-year", role: "input", order: 0 }, { fieldId: "f-cat", role: "input", order: 1, hidden: true }] }),
  };
  it("a Movie goes to the board whose rows are tagged movie — the fullest one", async () => {
    const b = await matchBoard({ userId: "u", gridId: "g", type: "Movie" }, deps);
    expect(b).toMatchObject({ id: "o-movies", label: "Movies" });
    expect(b.bindings).toEqual([{ fieldId: "f-year", role: "input", order: 0 }, { fieldId: "f-cat", role: "input", order: 1, hidden: true }]);
  });
  it("an Article is a plain page: no board", async () => {
    expect(await matchBoard({ userId: "u", gridId: "g", type: "Article" }, deps)).toBeNull();
  });
  it("a type the grid keeps nowhere: no board", () => {
    expect(pickBoardForType("Recipe", DESTS)).toBeNull();
  });
  it("a scalar agreed value matches too (Books)", () => {
    expect(pickBoardForType("Book", DESTS)?.id).toBe("o-books");
  });
});

describe("structuredFieldValues", () => {
  it("year into the number Year field, title into Title; a link field is never written", () => {
    expect(structuredFieldValues(FIELDS, { year: 2006, title: "A Guide", author: "Dito" }))
      .toEqual({ "f-year": 2006, "f-title": "A Guide" });
  });
});

describe("runImport: a typed page takes the board's row shape", () => {
  const MOVIE_HTML = `<html><head><title>A Guide (2006) - IMDb</title>
<script type="application/ld+json">{"@type":"Movie","name":"A Guide to Recognizing Your Saints","datePublished":"2006-10-27"}</script>
</head><body><article><h1>A Guide to Recognizing Your Saints</h1><p>A memoir of growing up in Astoria, told by the man who left it.</p></article></body></html>`;
  const board = { id: "o-movies", label: "Movies", shape: { autoFields: { "f-cat": ["movie"] } },
    fields: FIELDS, bindings: [{ fieldId: "f-year", role: "input", order: 0 }, { fieldId: "f-cat", role: "input", order: 1, hidden: true }] };

  it("the planned root binds the board's fields and carries the page's year and the board's category", async () => {
    const { runImport } = await import("../services/importPipeline.js");
    const out = await runImport({ source: { kind: "html", html: MOVIE_HTML, url: "https://imdb.test/t/1" }, userId: "u", gridId: "g", dryRun: true },
      { matchBoard: async ({ type }) => (type === "Movie" ? board : null) });
    expect(out.meta).toMatchObject({ type: "Movie", title: "A Guide to Recognizing Your Saints", board: { id: "o-movies" } });
    const root = out.plan.occurrences.find((o) => o.id === out.plan.rootOccurrenceId);
    const mod = out.plan.modules.find((m) => m.id === root.moduleId);
    expect(root.fields["f-year"].value).toBe(2006);
    expect(root.fields["f-cat"].value).toEqual(["movie"]);
    // The board's own category keeps its hidden flag; the year read off the page is shown.
    expect(mod.fieldBindings.find((b) => b.fieldId === "f-cat").hidden).toBe(true);
    expect(mod.fieldBindings.find((b) => b.fieldId === "f-year").hidden).toBeFalsy();
  });

  it("no grid (the eval runner): no board lookup at all — the control", async () => {
    const { runImport } = await import("../services/importPipeline.js");
    let asked = false;
    const out = await runImport({ source: { kind: "html", html: MOVIE_HTML, url: "https://imdb.test/t/1" }, userId: "u", gridId: null, dryRun: true },
      { matchBoard: async () => { asked = true; return board; } });
    expect(asked).toBe(false);
    expect(out.meta.board).toBeUndefined();
  });
});
