// @vitest-environment jsdom
// A drop that throws must not leave the tab's operations switched off.
//
// User, 2026-11-06: "i noticed daypage and schedule fail to build on future days". A tab open ~50 minutes
// stopped building the day it navigated to, while a fresh tab and a reconnected tab both built it (measured
// with writes blocked). DragProvider opened the drop batch, ran routeDrop, then closed it — with no `finally`.
// One throwing drop left `_dropBatchFires` non-null, and from then on every top-level fire in that tab (the
// toolbar date change's NavigationOp included) was queued into a batch nothing would ever drain.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";

const calls = [];
let onFire = null;
vi.mock("../helpers/operationExecutor", async (orig) => {
  const real = await orig();
  return {
    ...real,
    runMatchingOperations: (ops, type, tx) => {
      calls.push({ type, tx });
      if (onFire) onFire(type, tx);
      return [];
    },
  };
});

vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });

import { bindSocketToStore, operationsBridge } from "../state/bindSocketToStore";

function bind() {
  const socket = { connected: true, on() {}, emit() {} };
  bindSocketToStore(socket, () => {}, {
    current: {
      gridId: "g1", userId: "u1", modules: [], occurrences: [],
      operations: [{ id: "op1", name: "Build", enabled: true, triggerObjects: [{ eventType: "onFilterChange" }] }],
      fields: [], modulesById: {}, occurrencesById: {}, grid: { activeFilterValues: {} },
    },
  });
}
const nav = (date) => operationsBridge.fireOperations("NavigationOp", { type: "NavigationOp", date, activeFilterValues: { f: date } });
const navs = () => calls.filter((c) => c.type === "NavigationOp").map((c) => c.tx.date);
const flush = async () => { for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(20); };

describe("the drop batch always closes", () => {
  beforeEach(() => { calls.length = 0; onFire = null; vi.useFakeTimers(); bind(); });
  afterEach(() => { vi.useRealTimers(); });

  it("a drop that throws still lets the next date change run its ops", () => {
    expect(() => operationsBridge.runDropBatch(() => { throw new Error("drop blew up"); })).toThrow("drop blew up");
    nav("2026-11-07");
    expect(navs()).toEqual(["2026-11-07"]); // ran now, not parked in a batch nobody drains
  });

  it("fires made during a normal drop wait for the drop, then run (the control)", async () => {
    operationsBridge.runDropBatch(() => { nav("2026-11-08"); expect(navs()).toEqual([]); });
    await flush();
    expect(navs()).toEqual(["2026-11-08"]);
  });

  it("one held fire that throws does not stop the rest of the batch", async () => {
    onFire = (type, tx) => { if (tx.date === "bad") throw new Error("op blew up"); };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    operationsBridge.runDropBatch(() => { nav("bad"); nav("2026-11-09"); });
    await flush();
    expect(navs()).toEqual(["bad", "2026-11-09"]);
    err.mockRestore();
  });

  it("DragProvider goes through runDropBatch, never a bare begin/end pair", () => {
    const src = fs.readFileSync(path.join(__dirname, "../helpers/DragProvider.jsx"), "utf8").replace(/\/\/.*$/gm, "");
    expect(src).toMatch(/operationsBridge\.runDropBatch/);
    expect(src).not.toMatch(/beginDropBatch|endDropBatch/);
  });
});
