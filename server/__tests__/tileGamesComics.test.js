// Guards 0251. It deliberately overrides 0248's measured coverage refusal for
// two named kinds, so the question each test answers is "could this sweep in
// boards the user did NOT ask for?"
import { describe, it, expect } from "vitest";
import { planTileByKind, KINDS_TO_TILE } from "../migrations/0251-tile-games-and-comics.mjs";

const MODS = [
  { id: "m-board", role: "container", kind: "board" },
  { id: "m-game",  role: "artifact", kind: "game" },
  { id: "m-comic", role: "artifact", kind: "comic" },
  { id: "m-song",  role: "artifact", kind: "song" },
  { id: "m-movie", role: "artifact", kind: "movie" },
];
const HOUSE = { childMinWidth: 184, childMaxHeight: null, childGap: null };
const board = (id, label, rowMod, n, meta = {}) => ({
  id, moduleId: "m-board", label, meta,
  occurrences: Array.from({ length: n }, (_, i) => `${id}-r${i}`),
});
const rows = (id, rowMod, n) => Array.from({ length: n }, (_, i) => ({ id: `${id}-r${i}`, moduleId: rowMod, occurrences: [] }));
const run = (occ) => planTileByKind({ occurrences: occ, modules: MODS, kinds: KINDS_TO_TILE, houseSize: HOUSE });

describe("0251 — tiling the two boards the user named", () => {
  it("tiles a game board and a comic board", () => {
    const occ = [board("g", "Games", "m-game", 4), ...rows("g", "m-game", 4),
                 board("c", "Comics", "m-comic", 5), ...rows("c", "m-comic", 5)];
    const t = run(occ);
    expect(t.map(x => x.label).sort()).toEqual(["Comics", "Games"]);
    expect(t[0].next.mode).toBe("wrap");
    expect(t[0].next.childMinWidth).toBe(184);          // the house shape, not a restated number
    expect(t[0].next.childContentDirection).toBe("column");
  });

  it("does NOT sweep in the boards the coverage rule still refuses (Songs)", () => {
    const occ = [board("s", "Songs", "m-song", 10), ...rows("s", "m-song", 10)];
    expect(run(occ)).toEqual([]);
  });

  it("leaves Movies alone — 0248 already owns it", () => {
    const occ = [board("m", "Movies", "m-movie", 8), ...rows("m", "m-movie", 8)];
    expect(run(occ)).toEqual([]);
  });

  it("reports an already-tiled board as unchanged, so a re-run is a no-op", () => {
    const occ = [board("g", "Games", "m-game", 4, { layoutCascadeOverride: { mode: "wrap" } }), ...rows("g", "m-game", 4)];
    expect(run(occ)[0].already).toBe(true);
  });

  it("MERGES over an existing override instead of replacing it", () => {
    const occ = [board("g", "Games", "m-game", 4, { layoutCascadeOverride: { stickyHeaders: true } }), ...rows("g", "m-game", 4)];
    expect(run(occ)[0].next.stickyHeaders).toBe(true);
  });

  it("ignores an empty board", () => {
    expect(run([board("g", "Games", "m-game", 0)])).toEqual([]);
  });

  it("names exactly the two kinds the user asked for", () => {
    expect([...KINDS_TO_TILE].sort()).toEqual(["comic", "game"]);
  });
});
