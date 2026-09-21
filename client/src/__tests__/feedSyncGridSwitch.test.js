/**
 * feedSyncGridSwitch.test.js
 *
 * CREATING A NEW GRID MINTED 87 FEED COPIES OF THE PREVIOUS GRID INTO IT.
 *
 * Measured on prod 2026-09-21: a brand-new grid held 92 occurrences, 5 of them
 * mine. The other 87 were feed copies of poms grid content — `meta.feedSourceId`
 * set, `moduleId` pointing at a module whose `gridId` is poms, `parentId` naming
 * a poms occurrence — all stamped `gridId: <the new grid>`. They are invisible in
 * the app (their parent is not in this grid), so nothing would ever have shown it.
 *
 * THE WINDOW: `scheduleFeedSync` is a debounced timer that reads `stateRef.current`
 * when it FIRES, and `syncAllFeeds` takes its `gridId` from that same state. The
 * overlay it merges on top (`localOccsById`) is only cleared by `resetLocalOccs()`
 * inside `runLoadSweep`, which is DEFERRED past first paint. So between a grid
 * switch and that sweep, one pass can pair THE NEW GRID'S ID with THE OLD GRID'S
 * OCCURRENCES.
 *
 * The guard drops overlay entries that explicitly name a different grid. Entries
 * naming NO grid are local optimistic mints that belong to the current one, so
 * only a disagreement is dropped — that asymmetry is the second test.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { bindSocketToStore } from "../state/bindSocketToStore";
import { syncAllFeeds } from "../helpers/feedSync";

vi.mock("../helpers/feedSync", () => ({ syncAllFeeds: vi.fn(() => ({ minted: 0, swept: 0 })) }));

const localStorageStore = {};
vi.stubGlobal("localStorage", {
  getItem: (k) => localStorageStore[k] ?? null,
  setItem: (k, v) => { localStorageStore[k] = String(v); },
  removeItem: (k) => { delete localStorageStore[k]; },
});

const OLD_GRID = "6a690f6fb8e785df961a9f3c"; // poms
const NEW_GRID = "6ab15587409e94bbeb462694"; // the grid just created

function makeMockSocket() {
  const listeners = {};
  return {
    connected: true,
    on(e, fn) { listeners[e] = fn; },
    emit() {},
    _trigger(e, ...a) { listeners[e]?.(...a); },
  };
}

/** Mount the bridge, seed the overlay with `overlayOccs`, then fire a sync. */
function runSync({ stateGridId, stateOccs, overlayOccs }) {
  const socket = makeMockSocket();
  const stateRef = {
    current: { modules: [], occurrences: stateOccs, operations: [], fields: [], gridId: stateGridId },
  };
  bindSocketToStore(socket, () => {}, stateRef);
  // The overlay is written through the socket echo chokepoint, which is how a
  // previous grid's rows get in there in the first place.
  for (const o of overlayOccs) socket._trigger("occurrence_updated", { occurrence: o });
  vi.advanceTimersByTime(2000);
  return syncAllFeeds.mock.calls.at(-1)?.[0];
}

beforeEach(() => { vi.useFakeTimers(); syncAllFeeds.mockClear(); });

describe("a feed sync never pairs one grid's id with another grid's occurrences", () => {
  test("the previous grid's overlay rows are not visible to a sync on the new grid", () => {
    const arg = runSync({
      stateGridId: NEW_GRID,
      stateOccs: [{ id: "mine", gridId: NEW_GRID }],
      overlayOccs: [
        { id: "poms-wake-up", gridId: OLD_GRID, label: "Wake Up" },
        { id: "poms-drink", gridId: OLD_GRID, label: "Drink" },
      ],
    });
    expect(arg).toBeTruthy();
    expect(Object.keys(arg.occurrencesById)).toEqual(["mine"]);
    expect(arg.occurrencesById["poms-wake-up"]).toBeUndefined();
  });

  test("an overlay row naming NO grid is a local mint and still reaches the sync", () => {
    const arg = runSync({
      stateGridId: NEW_GRID,
      stateOccs: [],
      overlayOccs: [{ id: "optimistic", label: "just created here" }],
    });
    expect(arg.occurrencesById["optimistic"]).toBeTruthy();
  });

  test("with no grid resolved yet, nothing is dropped", () => {
    const arg = runSync({
      stateGridId: null,
      stateOccs: [],
      overlayOccs: [{ id: "a", gridId: OLD_GRID }],
    });
    expect(arg.occurrencesById["a"]).toBeTruthy();
  });

  test("same-grid overlay rows still win over the state snapshot", () => {
    const arg = runSync({
      stateGridId: NEW_GRID,
      stateOccs: [{ id: "x", gridId: NEW_GRID, label: "stale" }],
      overlayOccs: [{ id: "x", gridId: NEW_GRID, label: "fresh" }],
    });
    expect(arg.occurrencesById["x"].label).toBe("fresh");
  });
});
