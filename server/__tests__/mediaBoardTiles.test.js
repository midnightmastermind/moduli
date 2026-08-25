// Guards 0248's selection rule. Tiling a board with no artwork turns every row
// into a taller empty box, so the question each test answers is "could this
// tile a board that has no pictures, or miss one that does?"
import { describe, it, expect } from "vitest";
import { planMediaTiles, mergeTileLayout, rowHasPicture, TILE_LAYOUT } from "../migrations/0248-media-boards-tile.mjs";

const MODS = [
  { id: "m-board",  role: "container", kind: "board", label: "Movies" },
  { id: "m-movie",  role: "artifact", kind: "movie",  label: "Movie" },
  { id: "m-game",   role: "artifact", kind: "game",   label: "Game" },
  { id: "m-book",   role: "artifact", kind: "book",   label: "Book" },
  { id: "m-img",    role: "artifact", kind: "image",  label: "poster", fileRef: "https://image.tmdb.org/p.jpg" },
  { id: "m-inst",   role: "instance", kind: "board",  label: "Task" },
];
const board = (rowIds, extra = {}) => ({ id: "board", moduleId: "m-board", occurrences: rowIds, ...extra });
const movie = (id, cover) => ({ id, moduleId: "m-movie", occurrences: [], ...(cover ? { meta: { cover } } : { meta: {} }) });
const plan = (occurrences, modules = MODS) => planMediaTiles({ occurrences, modules });
const COVER = "https://image.tmdb.org/t/p/w500/a.jpg";

describe("0248 — which media boards become tiles", () => {
  it("tiles a movie board whose rows carry posters", () => {
    const rows = ["a","b","c","d"].map((i) => movie(i, COVER));
    const { targets, refused } = plan([board(["a","b","c","d"]), ...rows]);
    expect(targets.map((t) => t.label)).toEqual(["Movies"]);
    expect(refused).toEqual([]);
    expect(targets[0].coverage).toBe(1);
  });

  it("REFUSES a media board with no pictures — Games and Comics are the live case", () => {
    const rows = ["a","b","c","d"].map((i) => ({ id: i, moduleId: "m-game", occurrences: [], meta: {} }));
    const { targets, refused } = plan([board(["a","b","c","d"]), ...rows]);
    expect(targets).toEqual([]);
    expect(refused.map((r) => r.withPic)).toEqual([0]);
  });

  it("REFUSES a board that is only PARTLY pictured — under the threshold", () => {
    const rows = [movie("a", COVER), movie("b"), movie("c"), movie("d")]; // 25%
    const { targets, refused } = plan([board(["a","b","c","d"]), ...rows]);
    expect(targets).toEqual([]);
    expect(refused[0].coverage).toBe(0.25);
  });

  it("ignores a NON-media board even when every row has a picture (Bookmarks)", () => {
    const rows = ["a","b","c","d"].map((i) => ({ id: i, moduleId: "m-book", occurrences: [], meta: { cover: COVER } }));
    const { targets, refused } = plan([board(["a","b","c","d"]), ...rows]);
    expect(targets).toEqual([]);
    expect(refused).toEqual([]);   // not even considered
  });

  it("leaves a board with fewer than 4 rows alone", () => {
    const rows = [movie("a", COVER), movie("b", COVER)];
    const { targets, refused } = plan([board(["a","b"]), ...rows]);
    expect(targets).toEqual([]);
    expect(refused).toEqual([]);
  });

  it("counts a poster attached as an artifact CHILD — 0246's shape, not just meta.cover", () => {
    const childrenOf = new Map([["a", [{ id: "p", moduleId: "m-img" }]]]);
    const modById = new Map(MODS.map((m) => [m.id, m]));
    expect(rowHasPicture({ id: "a", moduleId: "m-movie", meta: {} }, { modById, childrenOf, mediaFieldIds: new Set() })).toBe(true);
  });

  it("counts a media-role FIELD value — the route Readings uses", () => {
    const modById = new Map(MODS.map((m) => [m.id, m]));
    const row = { id: "a", moduleId: "m-movie", meta: {}, fields: { f1: { value: "occ-123" } } };
    expect(rowHasPicture(row, { modById, childrenOf: new Map(), mediaFieldIds: new Set(["f1"]) })).toBe(true);
    expect(rowHasPicture({ ...row, fields: { f1: { value: [] } } }, { modById, childrenOf: new Map(), mediaFieldIds: new Set(["f1"]) })).toBe(false);
  });

  it("writes a MAX WIDTH, which is the ask — and a wrapping row", () => {
    expect(TILE_LAYOUT.mode).toBe("wrap");
    expect(TILE_LAYOUT.childMaxWidth).toBeGreaterThan(0);
  });

  it("MERGES over existing cascade keys instead of replacing them", () => {
    const merged = mergeTileLayout({ stickyHeaders: true, childGap: 2 });
    expect(merged.stickyHeaders).toBe(true);          // survives
    expect(merged.childGap).toBe(TILE_LAYOUT.childGap); // ours wins
    expect(merged.mode).toBe("wrap");
  });

  it("reports an already-tiled board as unchanged, so a re-run is a no-op", () => {
    const rows = ["a","b","c","d"].map((i) => movie(i, COVER));
    const { targets } = plan([board(["a","b","c","d"], { meta: { layoutCascadeOverride: { ...TILE_LAYOUT } } }), ...rows]);
    expect(JSON.stringify(mergeTileLayout(targets[0].current))).toBe(JSON.stringify(targets[0].current));
  });
});
