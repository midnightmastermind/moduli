// Only the tab the server names (`feed_leader`) runs feed sync. Two tabs each
// materialising the same feeds swept each other's copies on every date step
// (prod, 2026-09-19). Server half: server/__tests__/feedLeader.test.js.
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../helpers/feedSync", () => ({ syncAllFeeds: vi.fn(() => ({ minted: 0, swept: 0, feeds: 0 })) }));
import { syncAllFeeds } from "../helpers/feedSync";
import { bindSocketToStore, operationsBridge } from "../state/bindSocketToStore";

vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });

function setup({ connected = true } = {}) {
  const listeners = {};
  const emitted = [];
  const socket = {
    id: "me", connected,
    on(ev, fn) { (listeners[ev] ||= []).push(fn); },
    off() {}, once() {},
    emit(ev, ...a) { emitted.push(ev); },
    _trigger(ev, ...a) { for (const fn of listeners[ev] || []) fn(...a); },
  };
  const stateRef = { current: { modules: [], occurrences: [], operations: [], fields: [], gridId: "g", userId: "u" } };
  const unbind = bindSocketToStore(socket, () => {}, stateRef);
  return { socket, emitted, unbind };
}

const runSync = () => { operationsBridge.scheduleFeedSync(); vi.advanceTimersByTime(1000); };

describe("one tab syncs feeds", () => {
  beforeEach(() => { vi.useFakeTimers(); syncAllFeeds.mockClear(); });
  afterEach(() => { vi.useRealTimers(); });

  test("a tab named leader syncs; a tab told another leads does not", () => {
    const { socket, unbind } = setup();
    socket._trigger("feed_leader", { leaderSocketId: "me" });
    syncAllFeeds.mockClear();
    runSync();
    expect(syncAllFeeds).toHaveBeenCalledTimes(1);

    socket._trigger("feed_leader", { leaderSocketId: "other" });
    syncAllFeeds.mockClear();
    runSync();
    expect(syncAllFeeds).not.toHaveBeenCalled();
    unbind();
  });

  test("becoming leader runs a pass straight away", () => {
    const { socket, unbind } = setup();
    socket._trigger("feed_leader", { leaderSocketId: "other" });
    syncAllFeeds.mockClear();
    socket._trigger("feed_leader", { leaderSocketId: "me" });
    vi.advanceTimersByTime(1000);
    expect(syncAllFeeds).toHaveBeenCalledTimes(1);
    unbind();
  });

  test("a disconnected follower still syncs for itself", () => {
    const { socket, unbind } = setup();
    socket._trigger("feed_leader", { leaderSocketId: "other" });
    socket.connected = false;
    syncAllFeeds.mockClear();
    runSync();
    expect(syncAllFeeds).toHaveBeenCalledTimes(1);
    unbind();
  });

  test("the first announcement after joining claims ONCE; later ones do not (no ping-pong)", () => {
    const { socket, emitted, unbind } = setup();
    socket._trigger("feed_leader", { leaderSocketId: "other" });
    socket._trigger("feed_leader", { leaderSocketId: "other2" });
    expect(emitted.filter((e) => e === "feed_claim")).toHaveLength(1);
    // Focusing the tab claims again.
    window.dispatchEvent(new Event("focus"));
    expect(emitted.filter((e) => e === "feed_claim")).toHaveLength(2);
    unbind();
  });
});

// A toolbar date change used to re-run every NavigationOp in EVERY open tab:
// each rebuilt the same columns, the server refused the duplicates, and each
// tab swept the other's rows (prod, 2026-09-19).
describe("a grid date change runs its ops in ONE tab", () => {
  let log;
  beforeEach(() => { log = vi.spyOn(console, "log").mockImplementation(() => {}); });
  afterEach(() => { log.mockRestore(); });
  const navFires = () => log.mock.calls.filter((c) => /\[op-fire\] depth=1 NavigationOp/.test(String(c[0]))).length;
  const change = (extra = {}) => ({ gridId: "g", grid: { activeFilterValues: { d: "2026-09-20" } }, ...extra });

  test("a change another tab made is not re-run here", () => {
    const { socket, unbind } = setup();
    socket._trigger("feed_leader", { leaderSocketId: "me" });
    socket._trigger("grid_updated", change({ originSocketId: "other-tab" }));
    expect(navFires()).toBe(0);
    unbind();
  });

  test("a change from no tab (the API) runs in the leader", () => {
    const { socket, unbind } = setup();
    socket._trigger("feed_leader", { leaderSocketId: "me" });
    socket._trigger("grid_updated", change());
    expect(navFires()).toBe(1);
    unbind();
  });

  test("...and not in a follower", () => {
    const { socket, unbind } = setup();
    socket._trigger("feed_leader", { leaderSocketId: "other" });
    socket._trigger("grid_updated", change());
    expect(navFires()).toBe(0);
    unbind();
  });

  test("the REST shape ({ grid } with the id inside) is applied", () => {
    const { socket, unbind } = setup();
    socket._trigger("feed_leader", { leaderSocketId: "me" });
    socket._trigger("grid_updated", { grid: { id: "g", activeFilterValues: { d: "2026-09-20" } } });
    expect(navFires()).toBe(1);
    unbind();
  });
});

