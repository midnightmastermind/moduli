// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { safeEmit } from "../helpers/offlineQueue";
import { setPanelIdsGetter } from "../helpers/localLayout";

const sock = () => ({ connected: true, emit: vi.fn() });
afterEach(() => { delete window.ModuliNative; setPanelIdsGetter(null); });

describe("a headset window never sets the desktop's layout (user, 2026-10-27)", () => {
  it("desktop: layout writes go out unchanged", () => {
    const s = sock();
    safeEmit(s, "update_grid", { gridId: "g", grid: { meta: { layoutTree: {} } } });
    safeEmit(s, "update_view", { view: { id: "v" } });
    expect(s.emit.mock.calls.map((c) => c[0])).toEqual(["update_grid", "update_view"]);
    expect(s.emit.mock.calls[0][1].keepLayout).toBeUndefined();
  });
  it("headset: grid writes carry keepLayout; panel pages stay local; other writes go out", () => {
    window.ModuliNative = {};
    setPanelIdsGetter(() => new Set(["panel1"]));
    const s = sock();
    safeEmit(s, "update_grid", { gridId: "g", grid: { meta: { layoutTree: {} } } });
    safeEmit(s, "update_view", { view: { id: "v" } });
    safeEmit(s, "update_occurrence", { occurrence: { id: "panel1", occurrences: [] } });
    safeEmit(s, "update_occurrence", { occurrence: { id: "row1", fields: {} } });
    const sent = s.emit.mock.calls.map((c) => c[0]);
    expect(sent).toEqual(["update_grid", "update_occurrence"]);
    expect(s.emit.mock.calls[0][1].keepLayout).toBe(true);
    expect(s.emit.mock.calls[1][1].occurrence.id).toBe("row1");
  });
});
