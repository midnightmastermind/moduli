// Every window keeps its own layout (2026-10-24): its layout writes still reach the server (the default for a new
// device), and other windows' layout changes are not taken as they arrive.
import { describe, it, expect, afterEach, vi } from "vitest";
import { setPanelIdsGetter, isLayoutWrite, incomingGridPatch } from "../helpers/localLayout.js";
import { safeEmit } from "../helpers/offlineQueue.js";

const sock = () => ({ connected: true, emit: vi.fn() });
afterEach(() => { setPanelIdsGetter(null); });

describe("localLayout", () => {
  it("names the layout writes", () => {
    setPanelIdsGetter(() => new Set(["panelA"]));
    expect(isLayoutWrite("update_view", {})).toBe(true);
    expect(isLayoutWrite("update_grid", {})).toBe(true);
    expect(isLayoutWrite("update_occurrence", { occurrence: { id: "panelA" } })).toBe(true);
    expect(isLayoutWrite("update_occurrence", { occurrence: { id: "row1" } })).toBe(false);
  });

  it("SENDS layout writes — nothing riding with them (a rename, field presets) is lost", () => {
    setPanelIdsGetter(() => new Set(["panelA"]));
    const s = sock();
    safeEmit(s, "update_view", { view: { id: "v1" } });
    safeEmit(s, "update_grid", { gridId: "g", grid: { name: "Renamed", meta: { fieldPresets: [] } } });
    safeEmit(s, "update_occurrence", { occurrence: { id: "panelA" } });
    expect(s.emit.mock.calls.map((c) => c[0])).toEqual(["update_view", "update_grid", "update_occurrence"]);
  });

  it("keeps this window's layout and date from another window's grid update, and takes everything else", () => {
    const out = incomingGridPatch(
      { activeFilterValues: { d: 1 }, cols: 4, name: "Poms", meta: { layoutTree: "theirs", vrOffice: { shelves: [] } } },
      { layoutTree: "mine" },
    );
    expect(out).toEqual({ name: "Poms", meta: { layoutTree: "mine", vrOffice: { shelves: [] } } });
  });
});
