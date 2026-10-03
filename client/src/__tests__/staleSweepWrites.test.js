// A sliced sweep must not overwrite a field written after it began (2026-10-03:
// a Completion Rate tile went 50 -> 0 right after the user unticked a task).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { dropStaleFieldWrites } from "../helpers/staleSweep";

const write = (itemId, fieldId, value) => ({ _effect: "UPDATE_ITEM_FIELD", itemId, fieldId, value });
describe("dropStaleFieldWrites", () => {
  const occs = {
    tile: { id: "tile", fields: { rate: { value: 50, timestamp: 2000 } } },
    other: { id: "other", fields: { rate: { value: 7, timestamp: 500 } } },
    local: { id: "local", fields: { rate: { value: 1 } }, fieldUpdatedAt: { rate: 2500 } },
  };
  it("drops a write to a field written after the sweep began", () => {
    expect(dropStaleFieldWrites([write("tile", "rate", 0)], occs, 1000)).toEqual([]);
  });
  it("keeps a write to a field last written before the sweep began (the control)", () => {
    expect(dropStaleFieldWrites([write("other", "rate", 9)], occs, 1000)).toHaveLength(1);
  });
  it("reads the local write stamp too", () => {
    expect(dropStaleFieldWrites([write("local", "rate", 3)], occs, 1000)).toEqual([]);
  });
  it("never touches other effects or display updates", () => {
    const ups = [{ _effect: "CREATE_ITEM", instance: {} }, { fieldId: "rate", occurrenceId: "tile", value: 0 }];
    expect(dropStaleFieldWrites(ups, occs, 1000)).toEqual(ups);
  });
});
describe("wiring", () => {
  it("only the sliced sweep passes startedAt, and the apply step filters with it", () => {
    const src = fs.readFileSync(path.join(__dirname, "../state/bindSocketToStore.js"), "utf8");
    expect(src).toMatch(/diagDepth: _diagDepth, startedAt \}\)\)\) \};/);
    expect(src).toMatch(/if \(startedAt != null\) allUpdates = dropStaleFieldWrites\(allUpdates, mergedOccsOverlay\(state\.occurrencesById\), startedAt\);/);
    expect((src.match(/startedAt \}\)/g) || []).length).toBe(1);
  });
});
