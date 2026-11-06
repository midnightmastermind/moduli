import { describe, it, expect } from "vitest";
import { snapshotLayout, applyWindowLayout, saveWindowLayout, readWindowLayout, incomingPanelUpdate } from "../helpers/windowLayout.js";

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

const state = {
  grid: { _id: "g", rows: 1, cols: 2, occurrences: ["pA", "pB"], activeFilterValues: { d: "2026-10-24" }, meta: { layoutTree: "mine", name: "x" } },
  views: [{ id: "v1", activeOccurrenceId: "page2" }],
  occurrencesById: { pA: { id: "pA", occurrences: ["page1", "page2"], placement: { row: 0, col: 0 } }, pB: { id: "pB", occurrences: [] } },
};

describe("each window keeps its own layout", () => {
  it("restores this window's panels, pages and split over what the server last had, but takes the grid's date", () => {
    const snap = snapshotLayout(state);
    const payload = {
      gridId: "g",
      grid: { _id: "g", rows: 2, cols: 2, occurrences: ["pA", "pB", "pC"], activeFilterValues: { d: "2026-10-01" }, name: "Shared name", meta: { layoutTree: "theirs", fieldPresets: [1] } },
      views: [{ id: "v1", activeOccurrenceId: "page1" }],
      occurrences: [
        { id: "pA", occurrences: ["page1"] }, { id: "pB", occurrences: ["x"] }, { id: "pC" },
        { id: "page1" }, { id: "page2" },
      ],
    };
    const out = applyWindowLayout(payload, snap);
    expect(out.grid.occurrences).toEqual(["pA", "pB"]);        // pC was added by another window: not shown here
    expect(out.grid.cols).toBe(2); expect(out.grid.rows).toBe(1);
    // The date is shared (2026-11-06): a window's own date showed in the toolbar while the pages and the build kept
    // the grid's, so the day on screen was never built.
    expect(out.grid.activeFilterValues).toEqual({ d: "2026-10-01" });
    expect(out.grid.meta).toEqual({ layoutTree: "mine", fieldPresets: [1] }); // shared meta kept
    expect(out.grid.name).toBe("Shared name");
    expect(out.views[0].activeOccurrenceId).toBe("page2");
    expect(out.occurrences.find((o) => o.id === "pA").occurrences).toEqual(["page1", "page2"]);
  });

  it("drops a panel deleted elsewhere, and never leaves the grid with no panels", () => {
    const snap = snapshotLayout(state);
    const gone = applyWindowLayout({ gridId: "g", grid: { occurrences: ["pB"] }, occurrences: [{ id: "pB" }], views: [] }, snap);
    expect(gone.grid.occurrences).toEqual(["pB"]);
    const none = applyWindowLayout({ gridId: "g", grid: { occurrences: ["pZ"] }, occurrences: [{ id: "pZ" }], views: [] }, snap);
    expect(none.grid.occurrences).toEqual(["pZ"]);
  });

  it("saves per window and per device, and a window reads its own first", () => {
    const session = mem(); const local = mem();
    saveWindowLayout("g", { grid: { cols: 3 } }, { session, local });
    expect(readWindowLayout("g", { session, local }).grid.cols).toBe(3);
    const freshTab = mem();
    expect(readWindowLayout("g", { session: freshTab, local }).grid.cols).toBe(3);
    expect(readWindowLayout("other", { session, local })).toBe(null);
  });

  it("another window's panel update keeps its rows' changes but not its layout", () => {
    const out = incomingPanelUpdate({ id: "pA", occurrences: ["theirs"], placement: {}, label: "Renamed" }, new Set(["pA"]));
    expect(out).toEqual({ id: "pA", label: "Renamed" });
    const row = { id: "r", occurrences: ["c"] };
    expect(incomingPanelUpdate(row, new Set(["pA"]))).toBe(row);
  });
});

// A phone on a mosaic grid shares one rows × cols layout (user, 2026-11-02: "my phone app doesnt show that" — the
// phone's own saved copy was laid over the 3 x 2 set on the server).
import { phoneSharesRowsCols, incomingPanelUpdate as incomingPanel } from "../helpers/windowLayout.js";
import { incomingGridPatch, setLocalLayout } from "../helpers/localLayout.js";
describe("phone on a mosaic grid", () => {
  const payload = {
    grid: { rows: 3, cols: 2, occurrences: ["a", "b"], meta: { layoutTree: { id: "t" } } },
    occurrences: [{ id: "a", placement: { row: 0, col: 0 } }, { id: "b", placement: { row: 0, col: 1, height: 3 } }, { id: "x" }],
    views: [{ id: "v", activeOccurrenceId: "p1" }],
  };
  const saved = { grid: { rows: 2, cols: 2, occurrences: ["a", "b", "x"] }, meta: {}, panels: { b: { placement: { row: 0, col: 0 } } }, views: { v: "x" } };
  it("takes the server's rows × cols, panel list and cells; keeps the window's page choice", () => {
    const out = applyWindowLayout(payload, saved, { phoneShared: true });
    expect(out.grid.rows).toBe(3);
    expect(out.grid.occurrences).toEqual(["a", "b"]);
    expect(out.occurrences.find((o) => o.id === "b").placement).toEqual({ row: 0, col: 1, height: 3 });
    expect(out.views[0].activeOccurrenceId).toBe("x");
  });
  it("a desktop window still lays its own copy over (control)", () => {
    const out = applyWindowLayout(payload, saved);
    expect(out.grid.rows).toBe(2);
    expect(out.occurrences.find((o) => o.id === "b").placement).toEqual({ row: 0, col: 0 });
  });
  it("only a phone looking at a mosaic grid shares", () => {
    expect(phoneSharesRowsCols(payload.grid, () => true)).toBe(true);
    expect(phoneSharesRowsCols(payload.grid, () => false)).toBe(false);
    expect(phoneSharesRowsCols({ rows: 2, meta: {} }, () => true)).toBe(false);
  });
  it("live updates: a phone keeps another phone's cells and grid size", () => {
    expect(incomingPanel({ id: "a", placement: { row: 2 }, occurrences: [1] }, new Set(["a"]), { phoneShared: true }).placement).toEqual({ row: 2 });
    expect(incomingPanel({ id: "a", placement: { row: 2 }, occurrences: [1] }, new Set(["a"])).placement).toBeUndefined();
    setLocalLayout(true);
    expect(incomingGridPatch({ rows: 3, activeFilterId: "f" }, {}, { keepGridKeys: ["rows"] })).toEqual({ rows: 3, activeFilterId: "f" });
    // another window's date change is taken here
    expect(incomingGridPatch({ cols: 4, activeFilterValues: { d: "2026-11-07" } }, {})).toEqual({ activeFilterValues: { d: "2026-11-07" } });
    expect(incomingGridPatch({ rows: 3 }, {})).toEqual({});
  });
});
