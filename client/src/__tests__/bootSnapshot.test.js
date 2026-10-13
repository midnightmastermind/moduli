import { describe, it, expect, beforeEach } from "vitest";
import { saveBootSnapshot, loadBootSnapshot, clearBootSnapshots, SNAPSHOT_MAX_AGE_MS } from "../helpers/bootSnapshot.js";

function memStore() { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); return true; }, clear: async () => { m.clear(); return true; } }; }
const payload = { gridId: "g1", occurrences: [{ id: "o1" }] };

describe("bootSnapshot", () => {
  let store; beforeEach(() => { store = memStore(); });
  it("round-trips a payload for the same user + grid", async () => {
    await saveBootSnapshot("u1", payload, { store, now: 1000 });
    expect(await loadBootSnapshot("u1", "g1", { store, now: 2000 })).toEqual(payload);
  });
  it("is per user and per grid", async () => {
    await saveBootSnapshot("u1", payload, { store, now: 1000 });
    expect(await loadBootSnapshot("u2", "g1", { store, now: 2000 })).toBeNull();
    expect(await loadBootSnapshot("u1", "g2", { store, now: 2000 })).toBeNull();
  });
  it("refuses a snapshot past the max age", async () => {
    await saveBootSnapshot("u1", payload, { store, now: 0 });
    expect(await loadBootSnapshot("u1", "g1", { store, now: SNAPSHOT_MAX_AGE_MS + 1 })).toBeNull();
  });
  it("fails quiet when the store throws", async () => {
    const bad = { get: async () => { throw new Error("x"); }, put: async () => { throw new Error("x"); }, clear: async () => { throw new Error("x"); } };
    expect(await saveBootSnapshot("u1", payload, { store: bad })).toBe(false);
    expect(await loadBootSnapshot("u1", "g1", { store: bad })).toBeNull();
  });
  it("logout clears it", async () => {
    await saveBootSnapshot("u1", payload, { store, now: 1 });
    await clearBootSnapshots({ store });
    expect(await loadBootSnapshot("u1", "g1", { store, now: 2 })).toBeNull();
  });
});
