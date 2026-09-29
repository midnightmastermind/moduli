// server/__tests__/destinationSearch.test.js
//
// "Where does this go?" over a grid with 22,000 occurrences. The existing
// GET /occurrences cannot answer it: no label search, and Occurrence.find()
// loads every row for the grid before paginating.
//
// The query direction is the whole design: match MODULE labels first (there
// are far fewer, and the label lives there), then find the occurrences that
// point at them.
import { describe, it, expect, vi, beforeEach } from "vitest";

let modules = [], occurrences = [];
const findChain = (rows) => ({
  sort: () => findChain(rows), limit: () => findChain(rows), lean: async () => rows,
});
vi.mock("../models/Module.js", () => ({ default: {
  find: (q) => {
    const rx = q.label?.$regex;
    const roles = q.role?.$in || [];
    if (q.id?.$in) return findChain(modules.filter((m) => q.id.$in.includes(m.id)));
    return findChain(modules.filter((m) =>
      roles.includes(m.role) && (!rx || new RegExp(rx, q.label.$options).test(m.label))));
  },
}}));
vi.mock("../models/Occurrence.js", () => ({ default: {
  find: (q) => {
    // Two shapes: by module (the hits) and by id (the crumb walk, one level
    // at a time). A mock that ignored the second would hide a full-grid scan.
    if (q.id?.$in) return findChain(occurrences.filter((o) => q.id.$in.includes(o.id)));
    const ids = q.moduleId?.$in || null;
    return findChain(occurrences.filter((o) => (!ids || ids.includes(o.moduleId))));
  },
}}));

const { searchDestinations, commonValues } = await import("../services/destinationSearch.js");

const mod = (id, label, role = "container", kind = "board") => ({ id, label, role, kind, gridId: "g1", userId: "u1" });
const occ = (id, moduleId, parentId = null, children = []) =>
  ({ id, moduleId, parentId, occurrences: children, gridId: "g1", userId: "u1" });

beforeEach(() => {
  modules = [
    mod("m-movies", "Movies"), mod("m-media", "Media", "page", "board"),
    mod("m-boards", "Boards", "page", "folder"), mod("m-books", "Books"),
    mod("m-row", "Brightburn", "artifact", "movie"),
  ];
  modules[4].fieldBindings = [
    { fieldId: "f-year", order: 1 },
    { fieldId: "f-rating", order: 0 },
    { fieldId: null, order: 2 },
  ];
  occurrences = [
    occ("o-boards", "m-boards"),
    occ("o-media", "m-media", "o-boards"),
    occ("o-movies", "m-movies", "o-media", ["o-row1", "o-row2"]),
    occ("o-books", "m-books", "o-media"),
    occ("o-row1", "m-row", "o-movies"),
  ];
});

describe("searchDestinations", () => {
  it("finds a container by label", async () => {
    const out = await searchDestinations({ userId: "u1", gridId: "g1", q: "mov" });
    expect(out.map((d) => d.label)).toContain("Movies");
  });

  it("carries a crumb so two same-named containers can be told apart", async () => {
    const out = await searchDestinations({ userId: "u1", gridId: "g1", q: "movies" });
    expect(out[0].crumb).toBe("Boards › Media");
  });

  it("reports the child count — 'like its 993 rows' needs a number", async () => {
    const out = await searchDestinations({ userId: "u1", gridId: "g1", q: "movies" });
    expect(out[0].childCount).toBe(2);
  });

  it("offers PAGES as well as containers", async () => {
    const out = await searchDestinations({ userId: "u1", gridId: "g1", q: "media" });
    expect(out.map((d) => d.role)).toContain("page");
  });

  it("never offers a leaf row as a destination", async () => {
    // "Brightburn" is an artifact/movie — a thing you place, not a place.
    const out = await searchDestinations({ userId: "u1", gridId: "g1", q: "bright" });
    expect(out).toEqual([]);
  });

  it("an empty query returns the destinations anyway, so the list opens populated", async () => {
    const out = await searchDestinations({ userId: "u1", gridId: "g1", q: "" });
    expect(out.length).toBeGreaterThan(0);
  });

  it("honours the cap", async () => {
    const out = await searchDestinations({ userId: "u1", gridId: "g1", q: "", limit: 2 });
    expect(out).toHaveLength(2);
  });

  it("never runs an UNSCOPED occurrence query — the reason this endpoint exists", async () => {
    // The first draft of this service resolved crumbs by loading every
    // occurrence on the grid, which is precisely the cost GET /occurrences
    // already pays. Every query must be scoped by module or by id.
    const seen = [];
    const Occurrence = (await import("../models/Occurrence.js")).default;
    const real = Occurrence.find;
    Occurrence.find = (q) => { seen.push(q); return real(q); };
    await searchDestinations({ userId: "u1", gridId: "g1", q: "movies" });
    Occurrence.find = real;
    for (const q of seen) expect(Boolean(q.moduleId?.$in || q.id?.$in)).toBe(true);
  });

  it("escapes a regex-special query instead of throwing", async () => {
    // A user typing "(" must not 500 the endpoint.
    await expect(searchDestinations({ userId: "u1", gridId: "g1", q: "(" })).resolves.toEqual([]);
  });

  it("carries the shape of the rows already in the destination", async () => {
    // "Add it as a movie" means artifact/kind:"movie" with its siblings'
    // bindings — a shape that exists in the data, not one from a palette.
    const out = await searchDestinations({ userId: "u1", gridId: "g1", q: "movies" });
    expect(out[0].shape).toMatchObject({ moduleId: "m-row", role: "artifact", kind: "movie" });
  });

  it("orders bindFields by their binding order, and drops bindings with no fieldId", async () => {
    const out = await searchDestinations({ userId: "u1", gridId: "g1", q: "movies" });
    expect(out[0].shape.bindFields).toEqual(["f-rating", "f-year"]);
  });

  it("gives an EMPTY destination a null shape — there is nothing to copy", async () => {
    const out = await searchDestinations({ userId: "u1", gridId: "g1", q: "books" });
    expect(out[0].shape).toBeNull();
  });

  it("carries the VALUES the rows agree on, as the (auto) pre-fill", async () => {
    // Every movie is Board Category: movie; their years differ.
    occurrences.push(occ("o-row2", "m-row", "o-movies"));
    occurrences.find((o) => o.id === "o-row1").fields = { "f-rating": { value: ["movie"] }, "f-year": { value: 2006 } };
    occurrences.find((o) => o.id === "o-row2").fields = { "f-rating": { value: ["movie"] }, "f-year": { value: 2019 } };
    const out = await searchDestinations({ userId: "u1", gridId: "g1", q: "movies" });
    expect(out[0].shape.autoFields).toEqual({ "f-rating": ["movie"] });
  });
});

describe("commonValues", () => {
  it("needs at least two rows — one row's title is not a shape", () => {
    expect(commonValues([{ fields: { a: { value: "x" } } }], ["a"])).toEqual({});
  });
  it("skips a field any sampled row leaves empty", () => {
    const rows = [{ fields: { a: { value: "x" } } }, { fields: { a: { value: "" } } }];
    expect(commonValues(rows, ["a"])).toEqual({});
  });
  it("keeps 0 and false when every row agrees on them", () => {
    const rows = [{ fields: { a: { value: 0 }, b: { value: false } } }, { fields: { a: { value: 0 }, b: { value: false } } }];
    expect(commonValues(rows, ["a", "b"])).toEqual({ a: 0, b: false });
  });
});
