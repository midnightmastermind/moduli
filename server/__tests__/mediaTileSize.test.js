// Guards 0250. The tile size is READ off the tracker tiles rather than
// restated, so the question each test answers is "could this elect the wrong
// shape, resize a board that is not a tile, or drift from the trackers?"
import { describe, it, expect } from "vitest";
import { planTileSizeMatch, SIZE_KEYS } from "../migrations/0250-media-tiles-match-trackers.mjs";

const MODS = [
  { id: "m-board", role: "container", kind: "board", label: "board" },
];
const wrap = (id, label, size, extra = {}) => ({
  id, moduleId: "m-board", label, occurrences: [],
  meta: { layoutCascadeOverride: { mode: "wrap", ...size, ...extra } },
});
const TRACKER = { childMinWidth: 184 };
const plan = (occ, media) => planTileSizeMatch({ occurrences: occ, modules: MODS, mediaBoardIds: media });

describe("0250 — media tiles take the house tile shape", () => {
  it("elects the shape used by the MOST wrap containers", () => {
    const occ = [
      wrap("t1", "Today's Physical", TRACKER), wrap("t2", "Today's Social", TRACKER), wrap("t3", "Today's Media", TRACKER),
      wrap("f1", "files", { childGap: 10 }),
      wrap("mov", "Movies", { childMinWidth: 150, childMaxHeight: 320, childGap: 10 }, { childContentDirection: "column" }),
    ];
    const p = plan(occ, ["mov"]);
    expect(p.refusals).toEqual([]);
    expect(p.houseSize.childMinWidth).toBe(184);
    expect(p.votes).toBe(3);
    expect(p.targets.map(t => t.id)).toEqual(["mov"]);
    expect(p.targets[0].next.childMinWidth).toBe(184);
  });

  it("the media board cannot vote for its OWN shape", () => {
    // 3 media boards sharing one shape vs 2 trackers — without the exclusion
    // the media shape would win and the migration would be a no-op.
    const occ = [
      wrap("t1", "T1", TRACKER), wrap("t2", "T2", TRACKER),
      wrap("m1", "Movies", { childMinWidth: 150 }), wrap("m2", "TV", { childMinWidth: 150 }), wrap("m3", "X", { childMinWidth: 150 }),
    ];
    const p = plan(occ, ["m1", "m2", "m3"]);
    expect(p.houseSize.childMinWidth).toBe(184);
  });

  it("SKIPS a media board that is not actually tiled — Games/Comics stay untiled", () => {
    const untiled = { id: "games", moduleId: "m-board", label: "Games", occurrences: [], meta: {} };
    const occ = [wrap("t1", "T1", TRACKER), wrap("t2", "T2", TRACKER), untiled];
    const p = plan(occ, ["games"]);
    expect(p.targets).toEqual([]);
  });

  it("REFUSES when no shape has a clear majority rather than guessing", () => {
    const occ = [wrap("a", "A", { childMinWidth: 184 }), wrap("b", "B", { childMinWidth: 150 }),
                 wrap("m", "Movies", { childMinWidth: 111 })];
    const p = plan(occ, ["m"]);
    expect(p.refusals.join(" ")).toMatch(/no clear majority/);
  });

  it("REFUSES when there is no wrap container to read a shape from", () => {
    const p = plan([{ id: "x", moduleId: "m-board", meta: {} }], ["x"]);
    expect(p.refusals.join(" ")).toMatch(/no wrap-mode container/);
  });

  it("KEEPS childContentDirection — size parity, not composition parity", () => {
    const occ = [wrap("t1", "T1", TRACKER), wrap("t2", "T2", TRACKER),
                 wrap("mov", "Movies", { childMinWidth: 150 }, { childContentDirection: "column" })];
    const p = plan(occ, ["mov"]);
    expect(p.targets[0].next.childContentDirection).toBe("column");  // picture still on top
    expect(p.targets[0].next.mode).toBe("wrap");
  });

  it("sets childMaxWidth to the tile width, so a narrow panel shrinks it", () => {
    const occ = [wrap("t1", "T1", TRACKER), wrap("t2", "T2", TRACKER), wrap("mov", "Movies", { childMinWidth: 150 })];
    const p = plan(occ, ["mov"]);
    expect(p.targets[0].next.childMaxWidth).toBe(184);
  });

  it("reports an already-matching board as unchanged (re-run is a no-op)", () => {
    const occ = [wrap("t1", "T1", TRACKER), wrap("t2", "T2", TRACKER), wrap("mov", "Movies", TRACKER)];
    const p = plan(occ, ["mov"]);
    expect(p.targets[0].already).toBe(true);
  });

  it("compares only SIZE keys", () => {
    expect(SIZE_KEYS).toEqual(["childMinWidth", "childMaxHeight", "childGap"]);
    expect(SIZE_KEYS).not.toContain("childContentDirection");
  });
});
