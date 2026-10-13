// While a boot snapshot shows, nothing may be written from it, and the app's own writers stand down.
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { safeEmit } from "../helpers/offlineQueue.js";
import { setSnapshotMode, bindSnapshotInputGuard } from "../state/snapshotMode.js";
import { withAction } from "../helpers/actionScope.js";
import { peekOfflineQueue, flushOfflineQueue } from "../helpers/offlineQueue.js";

const sock = () => ({ connected: true, emit: vi.fn() });
afterEach(() => setSnapshotMode(false));

describe("safeEmit during a boot snapshot", () => {
  it("drops every write, a user's included — the snapshot is read-only", () => {
    const s = sock(); setSnapshotMode(true);
    safeEmit(s, "update_occurrence", { occurrence: { id: "o" } });
    withAction("Changed a value", () => safeEmit(s, "update_occurrence", { occurrence: { id: "o2" } }));
    expect(s.emit).not.toHaveBeenCalled();
    expect(peekOfflineQueue()).toEqual([]);
  });
  it("holds a click while the snapshot shows, lets scrolling keys through, and releases after", () => {
    const t = new EventTarget();
    const off = bindSnapshotInputGuard(t);
    let clicks = 0, keys = 0;
    t.addEventListener("click", () => { clicks++; }); t.addEventListener("keydown", () => { keys++; });
    setSnapshotMode(true);
    t.dispatchEvent(new Event("click", { cancelable: true }));
    const down = Object.assign(new Event("keydown", { cancelable: true }), { key: "PageDown" });
    t.dispatchEvent(down);
    expect([clicks, keys]).toEqual([0, 1]);
    setSnapshotMode(false);
    t.dispatchEvent(new Event("click", { cancelable: true }));
    expect(clicks).toBe(1);
    off();
  });
  it("still lets a read through (the real state must be requested)", () => {
    const s = sock(); setSnapshotMode(true);
    safeEmit(s, "request_full_state", { gridId: "g" });
    expect(s.emit).toHaveBeenCalledTimes(1);
  });
  it("writes normally once the snapshot is gone (control)", () => {
    const s = sock();
    safeEmit(s, "update_occurrence", { occurrence: { id: "o" } });
    expect(s.emit).toHaveBeenCalledTimes(1);
  });
});

describe("the app's writers stand down (wiring)", () => {
  const read = (p) => fs.readFileSync(path.resolve(__dirname, p), "utf8");
  it("operations, feed sync, the scheduler and reminder sync check snapshot mode", () => {
    const b = read("../state/bindSocketToStore.js");
    expect(b).toMatch(/function fireOperations\(transactionType, transaction\) \{\n\s*if \(isSnapshotMode\(\)\) return;/);
    expect(b).toMatch(/_feedSyncTimer = null;\n\s*if \(isSnapshotMode\(\)\) return;/);
    expect(read("../state/useScheduler.js")).toMatch(/const tick = \(\) => \{\n\s*if \(isSnapshotMode\(\)\) return;/);
    expect(read("../hooks/useReminderSync.js")).toMatch(/setTimeout\(\(\) => \{\n\s*if \(isSnapshotMode\(\)\) return;/);
  });
  it("a snapshot draws and stops: no sweep, no deferred request, no save", () => {
    const b = read("../state/bindSocketToStore.js");
    const body = b.slice(b.indexOf("function onFullState("), b.indexOf("function onFullStateRest("));
    const ret = body.indexOf("if (fromSnapshot) return;");
    expect(ret).toBeGreaterThan(0);
    expect(body.indexOf("runLoadSweep(payload)")).toBeGreaterThan(ret);
    expect(body.indexOf("request_full_state_rest")).toBeGreaterThan(ret);
    expect(body.indexOf("scheduleSnapshotSave(payload)")).toBeGreaterThan(ret);
    expect(body).toMatch(/if \(!fromSnapshot\) \{ realFullStateSeen = true; setSnapshotMode\(false\); \}/);
    // queued edits are taken into the REAL payload before it is dispatched
    const take = body.indexOf("applyQueuedEditsToPayload(payload, peekOfflineQueue())");
    expect(take).toBeGreaterThan(0);
    expect(take).toBeLessThan(body.indexOf("ActionTypes.FULL_STATE"));
  });
  it("logout clears the snapshot", () => {
    expect(read("../helpers/authStorage.js")).toMatch(/clearBootSnapshots\(\)/);
    expect(read("../App.jsx")).toMatch(/onLogout=\{\(\) => \{ clearBootSnapshots\(\)/);
  });
});
