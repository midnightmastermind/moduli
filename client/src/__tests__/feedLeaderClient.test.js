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
