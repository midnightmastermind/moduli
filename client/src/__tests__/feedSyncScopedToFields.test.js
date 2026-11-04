// A field edit re-synced EVERY feed on the grid (~700ms per edit on a phone at 4x, 2026-11-04 sweep): a field
// write can only change which rows a feed holds when the feed reads that field — in a condition, its sort, or the
// filters it obeys. `onlyFieldIds` skips the rest; anything else (no list) still syncs every feed.
import { describe, it, expect, vi } from "vitest";
vi.mock("../state/selectors", async (orig) => {
  const real = await orig();
  return { ...real, resolveFeedItems: vi.fn(() => []) };
});
import { syncAllFeeds, feedMayReadFields } from "../helpers/feedSync";
import { resolveFeedItems } from "../state/selectors";

const owner = (id, feed, extra = {}) => ({ id, moduleId: `m-${id}`, occurrences: [], feed: { enabled: true, ...feed }, ...extra });
const state = { gridId: "g", userId: "u", grid: { _id: "g", namedFilters: [{ id: "nf", conditions: [{ fieldId: "date" }] }], activeFilterId: "nf" } };

describe("feedMayReadFields", () => {
  it("reads a field its conditions name, at any depth", () => {
    const f = owner("a", { conditions: [{ operator: "OR", conditions: [{ fieldId: "done", comparator: "IS", value: true }] }] });
    expect(feedMayReadFields(f, ["done"], { state })).toBe(true);
    expect(feedMayReadFields(f, ["notes"], { state })).toBe(false);
  });
  it("reads its sort field", () => {
    expect(feedMayReadFields(owner("a", { sort: { fieldId: "rank" } }), ["rank"], { state })).toBe(true);
  });
  it("reads the active named filter's fields and its own local filters", () => {
    expect(feedMayReadFields(owner("a", {}), ["date"], { state })).toBe(true);
    const local = owner("a", {}, { filters: [{ active: true, fieldId: "tag" }] });
    expect(feedMayReadFields(local, ["tag"], { state })).toBe(true);
  });
  it("a feed that names no changed field does not read it", () => {
    expect(feedMayReadFields(owner("a", { conditions: [{ path: "_ancestors", comparator: "HAS_ANCESTOR", value: "p" }] }), ["notes"], { state })).toBe(false);
  });
});

describe("syncAllFeeds({ onlyFieldIds })", () => {
  const occs = () => ({
    a: owner("a", { conditions: [{ fieldId: "done", comparator: "IS", value: true }] }),
    b: owner("b", { conditions: [{ fieldId: "kind", comparator: "IS", value: "x" }] }),
  });
  it("visits only the feeds that read a changed field", () => {
    resolveFeedItems.mockClear();
    const r = syncAllFeeds({ state, occurrencesById: occs(), modulesById: {}, dispatch: () => {}, socket: null, onlyFieldIds: ["done"] });
    expect(r.feeds).toBe(1);
    expect(resolveFeedItems.mock.calls.map((c) => c[0].id)).toEqual(["a"]);
  });
  it("with no list, every feed syncs — the control", () => {
    resolveFeedItems.mockClear();
    const r = syncAllFeeds({ state, occurrencesById: occs(), modulesById: {}, dispatch: () => {}, socket: null });
    expect(r.feeds).toBe(2);
  });
});

describe("updateOccurrence names the fields it changed to the feed scheduler", () => {
  it("a field edit asks for a pass over the feeds reading that field; a plain write asks for all", async () => {
    const { updateOccurrence } = await import("../helpers/CommitHelpers");
    const { operationsBridge } = await import("../state/bindSocketToStore");
    const saved = { s: operationsBridge.scheduleFeedSync, g: operationsBridge.getLocalOcc, f: operationsBridge.fireOperations };
    const calls = [];
    operationsBridge.scheduleFeedSync = (o) => calls.push(o);
    operationsBridge.getLocalOcc = () => null; operationsBridge.fireOperations = () => {};
    const socket = { emit: () => {}, connected: true };
    updateOccurrence({ dispatch: () => {}, socket, occurrence: { id: "r", fields: { done: { value: true } } }, emit: true, triggerField: { fieldId: "done", value: true } });
    updateOccurrence({ dispatch: () => {}, socket, occurrence: { id: "r", meta: { x: 1 } }, emit: true });
    Object.assign(operationsBridge, { scheduleFeedSync: saved.s, getLocalOcc: saved.g, fireOperations: saved.f });
    expect(calls[0]).toEqual({ fieldIds: ["done"] });
    expect(calls[1]).toEqual({ fieldIds: null });
  });
});
