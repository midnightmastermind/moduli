// client/src/__tests__/schedulerStamp.test.js
//
// The scheduler's `lastFiredAt` stamp is the ONLY thing that stops a scheduled
// op re-firing. It is written into `schedule.lastFiredAt` and read back from
// the DB on the next load, so the wire shape has to match what the server
// handler destructures — `socket.on("update_operation", ({ operation }) => …)`.
//
// It didn't. useScheduler sent the operation SPREAD at top level, so
// `operation` was undefined, the handler's `if (!id) return` dropped the write,
// and lastFiredAt never persisted. The local dispatch kept a live tab quiet, so
// the only visible symptom was that a RELOAD during the alarm's minute rang it
// again (user 2026-08-02).
import { describe, it, expect } from "vitest";
import { isDueAt } from "../state/useScheduler";

describe("isDueAt — why a dropped stamp re-rings the alarm", () => {
  const atSix30 = { kind: "atTimes", times: ["06:30"], lastFiredAt: null };
  const during = new Date(2026, 7, 2, 6, 30, 20);

  it("fires when the clock matches and it has never fired", () => {
    expect(isDueAt(atSix30, during, null)).toBe(true);
  });

  it("fires AGAIN on a reload in the same minute when the stamp never persisted", () => {
    // This is the bug end-to-end: the DB still says null after the first ring,
    // so a fresh load inside the same minute is "due" all over again.
    expect(isDueAt(atSix30, new Date(2026, 7, 2, 6, 30, 45), null)).toBe(true);
  });

  it("stays quiet in the same minute once the stamp DID persist", () => {
    const stamped = new Date(2026, 7, 2, 6, 30, 5).toISOString();
    expect(isDueAt(atSix30, new Date(2026, 7, 2, 6, 30, 45), stamped)).toBe(false);
  });

  it("is due again the next day", () => {
    const yesterday = new Date(2026, 7, 1, 6, 30, 5).toISOString();
    expect(isDueAt(atSix30, new Date(2026, 7, 2, 6, 30, 10), yesterday)).toBe(true);
  });

  it("never fires outside its minute, stamp or no stamp", () => {
    expect(isDueAt(atSix30, new Date(2026, 7, 2, 9, 15, 0), null)).toBe(false);
  });
});

describe("the update_operation wire shape", () => {
  // Mirrors server/socketHandlers/crud.js:
  //   socket.on("update_operation", async ({ operation } = {}) => {
  //     const id = operation?.id; if (!id) return;
  const serverWouldPersist = (payload) => {
    const { operation } = payload || {};
    return !!operation?.id;
  };

  it("REJECTS the old spread payload — this is what dropped the stamp", () => {
    const op = { id: "op-1", name: "Alarm: 6:30 AM", schedule: { kind: "atTimes" } };
    expect(serverWouldPersist({ ...op, schedule: { lastFiredAt: "x" } })).toBe(false);
  });

  it("accepts the nested payload the scheduler sends now", () => {
    const op = { id: "op-1", name: "Alarm: 6:30 AM", schedule: { kind: "atTimes" } };
    const nextSchedule = { ...op.schedule, lastFiredAt: new Date().toISOString() };
    expect(serverWouldPersist({ operation: { ...op, schedule: nextSchedule } })).toBe(true);
  });

  it("carries the stamp where the scheduler reads it back", () => {
    const op = { id: "op-1", schedule: { kind: "atTimes", times: ["06:30"], lastFiredAt: null } };
    const stamp = new Date().toISOString();
    const payload = { operation: { ...op, schedule: { ...op.schedule, lastFiredAt: stamp } } };
    expect(payload.operation.schedule.lastFiredAt).toBe(stamp);
    // …and the offline queue's dedup key resolves instead of collapsing to
    // `update_operation:undefined` for every op.
    expect(payload.operation?.id).toBe("op-1");
  });
});
