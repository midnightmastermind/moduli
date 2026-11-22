// @vitest-environment jsdom
// 2026-11-22: a date step's sweep is sliced (the page stays responsive while the panels' loaders are up), and a sweep
// overtaken by a newer date step applies nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
const sliced = [];
vi.mock("../helpers/operationExecutor", async (orig) => {
  const real = await orig();
  return { ...real,
    runMatchingOperations: () => { throw new Error("a date step must not run the one-task sweep"); },
    runMatchingOperationsSliced: (ops, type, tx) => new Promise((res) => { sliced.push({ type, tx, res }); }),
  };
});
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
import { bindSocketToStore, operationsBridge } from "../state/bindSocketToStore";
const applied = [];
function bind() {
  const socket = { connected: true, on() {}, emit: (e, d) => applied.push([e, d]) };
  bindSocketToStore(socket, () => {}, { current: {
    gridId: "g1", userId: "u1", modules: [], occurrences: [{ id: "x", fields: {} }], fields: [], modulesById: {}, occurrencesById: {},
    operations: [{ id: "op1", name: "Build", enabled: true, triggerObjects: [{ eventType: "onFilterChange" }] }], grid: { activeFilterValues: {} },
  } });
}
const nav = (date) => operationsBridge.fireOperations("NavigationOp", { type: "NavigationOp", date, activeFilterValues: { f: date } });
const effect = { _effect: "UPDATE_ITEM_LABEL", itemId: "x", label: "L" };

describe("a date step's sweep", () => {
  beforeEach(() => { sliced.length = 0; applied.length = 0; bind(); });
  afterEach(() => { delete window.__noNavSlice; });
  it("runs sliced, and applies what it computed", async () => {
    nav("2026-11-23");
    expect(sliced.map((s) => s.tx.date)).toEqual(["2026-11-23"]);
    sliced[0].res([effect]);
    await new Promise((r) => setTimeout(r, 0));
    expect(applied.some(([e, d]) => e === "update_occurrence" && d?.occurrence?.label === "L")).toBe(true);
  });
  it("an older sweep finishing after a newer date step applies nothing", async () => {
    nav("2026-11-23"); nav("2026-11-24");
    sliced[0].res([effect]);
    await new Promise((r) => setTimeout(r, 0));
    expect(applied.some(([e]) => e === "update_occurrence")).toBe(false);
  });
});
