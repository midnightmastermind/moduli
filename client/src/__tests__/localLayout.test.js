// "This device only" layout: while the VR office tab has it on, writes that
// change what panels show / the grid layout / the date filter never leave the
// tab. Everything else still reaches the server.
import { describe, it, expect, afterEach, vi } from "vitest";
import { setLocalLayout, setPanelIdsGetter, isLayoutWrite } from "../helpers/localLayout.js";
import { safeEmit } from "../helpers/offlineQueue.js";

const sock = () => ({ connected: true, emit: vi.fn() });

afterEach(() => { setLocalLayout(false); setPanelIdsGetter(null); });

describe("localLayout", () => {
  it("names the layout writes", () => {
    setPanelIdsGetter(() => new Set(["panelA"]));
    expect(isLayoutWrite("update_view", {})).toBe(true);
    expect(isLayoutWrite("update_grid", {})).toBe(true);
    expect(isLayoutWrite("update_occurrence", { occurrence: { id: "panelA" } })).toBe(true);
    expect(isLayoutWrite("update_occurrence", { occurrence: { id: "row1" } })).toBe(false);
    expect(isLayoutWrite("create_occurrence", {})).toBe(false);
  });

  it("keeps layout writes in this tab while on, and sends everything else", () => {
    setPanelIdsGetter(() => new Set(["panelA"]));
    setLocalLayout(true);
    const s = sock();
    safeEmit(s, "update_view", { view: { id: "v1" } });
    safeEmit(s, "update_grid", { gridId: "g", grid: { meta: {} } });
    safeEmit(s, "update_occurrence", { occurrence: { id: "panelA" } });
    safeEmit(s, "update_occurrence", { occurrence: { id: "row1" } });
    expect(s.emit.mock.calls.map((c) => c[0])).toEqual(["update_occurrence"]);
    expect(s.emit.mock.calls[0][1].occurrence.id).toBe("row1");
  });

  it("sends layout writes when off (every other device)", () => {
    const s = sock();
    safeEmit(s, "update_view", { view: { id: "v1" } });
    expect(s.emit).toHaveBeenCalledTimes(1);
  });

  it("survives a reload of the tab (sessionStorage)", () => {
    setLocalLayout(true);
    expect(sessionStorage.getItem("moduli-local-layout")).toBe("1");
    setLocalLayout(false);
    expect(sessionStorage.getItem("moduli-local-layout")).toBe(null);
  });
});

describe("incomingGridPatch", () => {
  it("passes a patch through untouched when the mode is off", async () => {
    const { incomingGridPatch } = await import("../helpers/localLayout.js");
    const p = { activeFilterValues: { d: 1 }, meta: { layoutTree: "theirs" } };
    expect(incomingGridPatch(p, { layoutTree: "mine" })).toBe(p);
  });

  it("keeps this tab's layout and date when on, and takes everything else", async () => {
    const { incomingGridPatch } = await import("../helpers/localLayout.js");
    setLocalLayout(true);
    const out = incomingGridPatch(
      { activeFilterValues: { d: 1 }, cols: 4, name: "Poms", meta: { layoutTree: "theirs", vrOffice: { shelves: [] } } },
      { layoutTree: "mine" },
    );
    expect(out).toEqual({ name: "Poms", meta: { layoutTree: "mine", vrOffice: { shelves: [] } } });
  });
});
