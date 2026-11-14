// The rest of a load is paced (server emitDeferred): at most REST_IN_FLIGHT chunks unacknowledged, so the heartbeat
// never waits behind the whole catalogue on a slow link; a client that never acks still gets everything.
import { describe, it, expect, vi, afterEach } from "vitest";
import { emitDeferred, REST_IN_FLIGHT, REST_ACK_GRACE_MS } from "../socketHandlers/state.js";

const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: `o${i}`, moduleId: "m", blob: "x".repeat(400_000) }));

function fakeSocket({ acks }) {
  const sent = [];
  const pending = [];
  let maxUnacked = 0;
  const socket = {
    disconnected: false,
    emit: (ev, p) => sent.push({ p, paced: false }),
    timeout: () => ({
      emitWithAck: (ev, p) => {
        sent.push({ p, paced: true });
        return new Promise((resolve) => {
          pending.push(resolve);
          maxUnacked = Math.max(maxUnacked, pending.length);
          if (acks) setTimeout(() => { pending.splice(pending.indexOf(resolve), 1); resolve(); }, 5);
        });
      },
    }),
  };
  return { socket, sent, maxUnacked: () => maxUnacked };
}

describe("the rest is paced", () => {
  afterEach(() => vi.useRealTimers());
  it("keeps at most two chunks unacknowledged and sends them all in order", async () => {
    const f = fakeSocket({ acks: true });
    await emitDeferred({ socket: f.socket, gridId: "g", deferred: rows(20), deferredModules: [] });
    expect(f.maxUnacked()).toBeLessThanOrEqual(REST_IN_FLIGHT);
    expect(f.sent.map((s) => s.p.chunk)).toEqual(f.sent.map((_, i) => i + 1));
    expect(f.sent.at(-1).p.done).toBe(true);
    expect(f.sent.every((s) => s.paced)).toBe(true);
  });
  it("sends the rest unpaced to a client that never acks (an older build)", async () => {
    vi.useFakeTimers();
    const f = fakeSocket({ acks: false });
    const run = emitDeferred({ socket: f.socket, gridId: "g", deferred: rows(20), deferredModules: [] });
    await vi.advanceTimersByTimeAsync(REST_ACK_GRACE_MS + 10);
    await run;
    expect(f.sent.at(-1).p.done).toBe(true);
    expect(f.sent.some((s) => !s.paced)).toBe(true);
  });
  it("stops when cancelled by a newer answer", async () => {
    const f = fakeSocket({ acks: true });
    let n = 0;
    await emitDeferred({ socket: f.socket, gridId: "g", deferred: rows(20), deferredModules: [], isCancelled: () => ++n > 3 });
    expect(f.sent.length).toBe(3);
  });
});
