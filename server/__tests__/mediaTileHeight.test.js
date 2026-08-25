// Guards 0252. Raising the height must reach the boards that carry a picture
// and NOT the ones that do not, or Games/Comics become two-thirds-empty tiles.
import { describe, it, expect } from "vitest";
import { planTileHeights, TILE_H } from "../migrations/0252-media-tiles-fit-fields.mjs";

const wrap = (id, label, extra = {}) => ({
  id, label, meta: { layoutCascadeOverride: { mode: "wrap", childMinWidth: 184, ...extra } },
});
const plain = (id, label) => ({ id, label, meta: {} });

// Stand-in for 0248's coverage rule: whatever it calls a target is pictured.
const fakePlan = (pictured) => () => ({ targets: pictured, refused: [] });

describe("0252 — media tiles tall enough to show their fields", () => {
  it("raises a pictured, tiled board to the measured height", () => {
    const occ = [wrap("mov", "Movies")];
    const t = planTileHeights({ occurrences: occ, modules: [], planMediaTiles: fakePlan([{ id: "mov", label: "Movies" }]) });
    expect(t).toHaveLength(1);
    expect(t[0].next.childMaxHeight).toBe(TILE_H);
    expect(t[0].next.childMinWidth).toBe(184);   // merges, does not replace
    expect(t[0].next.mode).toBe("wrap");
  });

  it("does NOT raise a board with no cover art — Games/Comics keep the tracker height", () => {
    const occ = [wrap("games", "Games")];
    // 0248's rule refuses it, so it is never a target
    const t = planTileHeights({ occurrences: occ, modules: [], planMediaTiles: fakePlan([]) });
    expect(t).toEqual([]);
  });

  it("skips a pictured board that is not actually tiled", () => {
    const occ = [plain("mov", "Movies")];
    const t = planTileHeights({ occurrences: occ, modules: [], planMediaTiles: fakePlan([{ id: "mov", label: "Movies" }]) });
    expect(t).toEqual([]);
  });

  it("reports an already-raised board as unchanged (re-run is a no-op)", () => {
    const occ = [wrap("mov", "Movies", { childMaxHeight: TILE_H })];
    const t = planTileHeights({ occurrences: occ, modules: [], planMediaTiles: fakePlan([{ id: "mov", label: "Movies" }]) });
    expect(t[0].already).toBe(true);
  });

  it("the height clears the measured 432px of content", () => {
    expect(TILE_H).toBeGreaterThanOrEqual(432);
  });
});
