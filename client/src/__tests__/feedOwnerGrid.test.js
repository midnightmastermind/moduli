/**
 * feedOwnerGrid.test.js
 *
 * A TAB SYNCS ONLY THE FEEDS OF THE GRID IT IS ON.
 *
 * Measured on prod 2026-09-22, rebuilding poms grid through the UI: switching
 * the rebuild grid's "Ingredients" container to Feed On minted 50 copies of
 * POMS GRID rows under it — and tagged each poms source's `linkedGroupId` on
 * the way out. Invisible in both grids: the parent lives in one, the rows name
 * the other.
 *
 * THE LEAK: every occurrence write is broadcast to the USER room, not the grid
 * room (server socketHandlers/occurrences.js:443 and ~20 more sites), so every
 * tab of a user holds every other grid's rows. `_syncAllFeeds` then walked the
 * whole map looking for `feed.enabled` with no grid check, found an owner from
 * the OTHER grid, and minted into it with `state.gridId` — the wrong grid's id.
 *
 * TWO GUARDS, one per side of the pairing, and NEITHER subsumes the other:
 *   pull side (selectors.js)   a candidate from another grid is never a source.
 *                              Covers 2026-09-22: foreign SOURCES, local owner.
 *   owner side (here)          a feed owner from another grid is skipped whole.
 *                              Covers 2026-09-21: a foreign owner pulling its
 *                              OWN grid's rows — which the pull guard allows,
 *                              since owner and sources agree — minting copies
 *                              stamped with THIS tab's grid id (87 of them).
 * So this file's world is the second shape: owner and rows both foreign.
 *
 * A row that names NO grid is a local optimistic mint belonging to the current
 * one — only an explicit disagreement is dropped, the same asymmetry the
 * overlay guard uses (feedSyncGridSwitch.test.js).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncAllFeeds } from "../helpers/feedSync";

const POMS = "6a690f6fb8e785df961a9f3c";
const REBUILD = "6ab15587409e94bbeb462694";

const modulesById = {
  mBox: { id: "mBox", role: "container", kind: "board", label: "box" },
  mRow: { id: "mRow", role: "instance", kind: "board", label: "row" },
};

const withGrid = (gridId) => (gridId === undefined ? {} : { gridId });

/** A feed owner and two rows that share its grid, seen by a tab on another one. */
function world({ ownerGridId, rowGridId }) {
  return {
    box: {
      id: "box", moduleId: "mBox", occurrences: [], ...withGrid(ownerGridId),
      feed: { enabled: true, roles: ["instance"], limit: 50 },
    },
    r1: { id: "r1", moduleId: "mRow", ...withGrid(rowGridId), fields: {} },
    r2: { id: "r2", moduleId: "mRow", ...withGrid(rowGridId), fields: {} },
  };
}

function run({ ownerGridId, rowGridId, stateGridId = POMS }) {
  const emitted = [];
  const socket = { connected: true, emit: (...a) => emitted.push(a), io: { opts: {} } };
  const occurrencesById = world({ ownerGridId, rowGridId });
  const state = {
    userId: "u1", gridId: stateGridId,
    grid: { _id: stateGridId, namedFilters: [], activeFilterId: null },
    occurrences: Object.values(occurrencesById),
  };
  const res = syncAllFeeds({ state, occurrencesById, modulesById, dispatch: vi.fn(), socket });
  const creates = emitted.filter(([ev]) => ev === "create_occurrence").map(([, p]) => p.occurrence);
  const linkTags = emitted
    .filter(([ev, p]) => ev === "update_occurrence" && p?.occurrence?.linkedGroupId)
    .map(([, p]) => p.occurrence.id);
  return { ...res, creates, linkTags };
}

beforeEach(() => vi.clearAllMocks());

describe("a tab syncs only its own grid's feeds", () => {
  it("never mints into a feed owner that belongs to another grid", () => {
    const r = run({ ownerGridId: REBUILD, rowGridId: REBUILD }); // the tab is on poms
    expect(r.minted).toBe(0);
    expect(r.creates).toHaveLength(0);
  });

  it("and never stamps linkedGroupId on that grid's rows for it", () => {
    // The stamp is the half that reached data nobody was editing: the sources
    // carried a linkedGroupId afterwards that no gesture had asked for.
    expect(run({ ownerGridId: REBUILD, rowGridId: REBUILD }).linkTags).toEqual([]);
  });

  it("does not even visit it, so a later change of mind cannot mint either", () => {
    expect(run({ ownerGridId: REBUILD, rowGridId: REBUILD }).feeds).toBe(0);
  });

  it("CONTROL — an owner on this grid still mints", () => {
    const r = run({ ownerGridId: POMS, rowGridId: POMS });
    expect(r.minted).toBe(2);
    expect(r.creates.map((c) => c.parentId)).toEqual(["box", "box"]);
    expect(r.creates.map((c) => c.gridId)).toEqual([POMS, POMS]);
  });

  it("CONTROL — an owner naming NO grid is a local mint and still syncs", () => {
    expect(run({ ownerGridId: undefined, rowGridId: POMS }).minted).toBe(2);
  });

  it("CONTROL — with no grid resolved yet, the owner is still visited", () => {
    expect(run({ ownerGridId: REBUILD, rowGridId: REBUILD, stateGridId: null }).feeds).toBe(1);
  });
});
