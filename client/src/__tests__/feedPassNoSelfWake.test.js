// @vitest-environment jsdom
// A feed pass's own writes (a mint tagging its source, a relist of the parent) went through updateOccurrence and
// asked for another whole pass, which asked again: three passes per date step on poms grid, the last two finding
// nothing (2026-11-06). A request made while a pass runs is the pass itself and is ignored.
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../helpers/feedSync", () => ({ syncAllFeeds: vi.fn(() => ({ minted: 0, swept: 0, feeds: 0 })) }));
import { syncAllFeeds } from "../helpers/feedSync";
import { bindSocketToStore, operationsBridge } from "../state/bindSocketToStore";

vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });

function setup() {
  const listeners = {};
  const socket = { id: "me", connected: true, on(ev, fn) { (listeners[ev] ||= []).push(fn); }, off() {}, once() {}, emit() {},
    _trigger(ev, ...a) { for (const fn of listeners[ev] || []) fn(...a); } };
  const stateRef = { current: { modules: [], occurrences: [], operations: [], fields: [], gridId: "g", userId: "u" } };
  const unbind = bindSocketToStore(socket, () => {}, stateRef);
  socket._trigger("feed_leader", { leaderSocketId: "me" });
  vi.advanceTimersByTime(1000);
  syncAllFeeds.mockClear();
  return unbind;
}

describe("a feed pass does not wake itself", () => {
  beforeEach(() => { vi.useFakeTimers(); syncAllFeeds.mockReset(); syncAllFeeds.mockImplementation(() => ({ minted: 0, swept: 0, feeds: 0 })); });
  afterEach(() => { vi.useRealTimers(); });

  test("a request made during the pass runs no second pass", () => {
    const unbind = setup();
    syncAllFeeds.mockImplementation(() => { operationsBridge.scheduleFeedSync(); return { minted: 1, swept: 0, feeds: 1 }; });
    operationsBridge.scheduleFeedSync();
    vi.advanceTimersByTime(5000);
    expect(syncAllFeeds).toHaveBeenCalledTimes(1);
    unbind();
  });

  test("a request after the pass still runs one — the control", () => {
    const unbind = setup();
    operationsBridge.scheduleFeedSync(); vi.advanceTimersByTime(1000);
    operationsBridge.scheduleFeedSync(); vi.advanceTimersByTime(1000);
    expect(syncAllFeeds).toHaveBeenCalledTimes(2);
    unbind();
  });

  test("a pass that throws does not leave requests switched off", () => {
    const unbind = setup();
    syncAllFeeds.mockImplementationOnce(() => { throw new Error("boom"); });
    operationsBridge.scheduleFeedSync(); vi.advanceTimersByTime(1000);
    operationsBridge.scheduleFeedSync(); vi.advanceTimersByTime(1000);
    expect(syncAllFeeds).toHaveBeenCalledTimes(2);
    unbind();
  });
});
