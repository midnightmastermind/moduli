import { describe, it, expect, vi } from "vitest";
import { summarizeOpResults, makeOpNotificationCallbacks } from "../helpers/opResultSummary";

const fieldsById = {
  f1: { id: "f1", name: "Tasks Completed" },
  f2: { id: "f2", name: "Tasks Left" },
  f3: { id: "f3", name: "Water" },
};
const modulesById = {
  m1: { id: "m1", label: "Completed" },
  m2: { id: "m2", label: "Stretching" },
};
const occurrencesById = {
  goal1: { id: "goal1", moduleId: "m1" },
  occ2: { id: "occ2", moduleId: "m2" },
};
const ctx = { fieldsById, occurrencesById, modulesById };

describe("summarizeOpResults", () => {
  it("names occurrence-scoped field writes with the new value", () => {
    const s = summarizeOpResults([
      { _effect: "UPDATE_ITEM_FIELD", itemId: "goal1", fieldId: "f1", value: 2, subKind: "value" },
      { _effect: "UPDATE_ITEM_FIELD", itemId: "goal1", fieldId: "f2", value: 8, subKind: "value" },
    ], ctx);
    expect(s).toContain("Completed: Tasks Completed→2");
    expect(s).toContain("Completed: Tasks Left→8");
  });

  it("keeps the LAST value for repeated writes to the same field", () => {
    const s = summarizeOpResults([
      { _effect: "UPDATE_ITEM_FIELD", itemId: "goal1", fieldId: "f1", value: 1, subKind: "value" },
      { _effect: "UPDATE_ITEM_FIELD", itemId: "goal1", fieldId: "f1", value: 3, subKind: "value" },
    ], ctx);
    expect(s).toBe("Completed: Tasks Completed→3");
  });

  it("skips flow-only writes", () => {
    const s = summarizeOpResults([
      { _effect: "UPDATE_ITEM_FIELD", itemId: "goal1", fieldId: "f1", value: "in", subKind: "flow" },
    ], ctx);
    expect(s).toBe("");
  });

  it("includes display updates (computedValues)", () => {
    const s = summarizeOpResults([{ fieldId: "f3", occurrenceId: "goal1", value: 32 }], ctx);
    expect(s).toBe("Completed: Water→32");
  });

  it("groups creates by label with counts and names deletes/moves", () => {
    const s = summarizeOpResults([
      { _effect: "CREATE_ITEM", instance: { id: "x", templateId: "m2" } },
      { _effect: "CREATE_ITEM", instance: { id: "y", templateId: "m2" } },
      { _effect: "DELETE_ITEM", itemId: "occ2" },
      { _effect: "MOVE_OCCURRENCE", occurrenceId: "occ2" },
    ], ctx);
    expect(s).toContain("+2 Stretching");
    expect(s).toContain("−Stretching");
    expect(s).toContain("→Stretching");
  });

  it("formats booleans as check/cross and truncates long strings", () => {
    const s = summarizeOpResults([
      { _effect: "UPDATE_ITEM_FIELD", itemId: "occ2", fieldId: "f1", value: true, subKind: "value" },
      { _effect: "UPDATE_ITEM_FIELD", itemId: "occ2", fieldId: "f2", value: "a very long string value that keeps going", subKind: "value" },
    ], ctx);
    expect(s).toContain("Tasks Completed→✓");
    expect(s).toContain("…");
  });

  it("names every other effect type instead of dropping it", () => {
    const s = summarizeOpResults([
      { _effect: "UPDATE_OCCURRENCE", occurrence: { id: "occ2" } },
      { _effect: "SET_FILTER" },
      { _effect: "ADD_TO_POOL" },
      { _effect: "ADD_TO_POOL" },
    ], ctx);
    expect(s).toContain("updated Stretching");
    expect(s).toContain("filter set");
    expect(s).toContain("added to pool ×2");
  });

  it("collapses overflow past 12 segments into +N more", () => {
    const results = Array.from({ length: 20 }, (_, i) => ({
      _effect: "UPDATE_ITEM_FIELD", itemId: null, fieldId: `f${i}`, value: i, subKind: "value",
    }));
    const s = summarizeOpResults(results, { fieldsById: {}, occurrencesById: {}, modulesById: {} });
    expect(s).toContain("+8 more");
    expect(s.split(" · ").length).toBe(13);
  });

  it("returns empty string for empty/no results", () => {
    expect(summarizeOpResults([], ctx)).toBe("");
    expect(summarizeOpResults(null, ctx)).toBe("");
  });
});

describe("makeOpNotificationCallbacks", () => {
  it("onSuccess pushes a success pill with the summary", () => {
    const push = vi.fn();
    const { onSuccess } = makeOpNotificationCallbacks(push, () => ctx);
    onSuccess("Tracker: Tasks Completed", [
      { _effect: "UPDATE_ITEM_FIELD", itemId: "goal1", fieldId: "f1", value: 2, subKind: "value" },
    ]);
    expect(push).toHaveBeenCalledWith({
      kind: "success",
      label: '"Tracker: Tasks Completed" — Completed: Tasks Completed→2',
    });
  });

  it("onSuccess falls back to ran when nothing summarizable", () => {
    const push = vi.fn();
    const { onSuccess } = makeOpNotificationCallbacks(push, () => ctx);
    onSuccess("Some Op", [{ _effect: "UPDATE_ITEM_FIELD", fieldId: "f1", subKind: "flow" }]);
    expect(push).toHaveBeenCalledWith({ kind: "success", label: '"Some Op" ran' });
  });

  it("onError pushes an error pill with the message", () => {
    const push = vi.fn();
    const { onError } = makeOpNotificationCallbacks(push, () => ctx);
    onError("Broken Op", new Error("boom"));
    expect(push).toHaveBeenCalledWith({ kind: "error", label: '"Broken Op" failed — boom' });
  });
});
