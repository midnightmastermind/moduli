// A sliced sweep must not overwrite a field written after it began (2026-10-03:
// a Completion Rate tile went 50 -> 0 right after the user unticked a task).
//
// 2026-11-04: it compared the sweep's start (this tab's clock) against the field's stored
// timestamps — and the server's save ack REPLACES `fieldUpdatedAt` with the SERVER's clock. With the
// server ~2s ahead (measured), a field the server stamped a moment ago read as "written after" any
// sweep started in the next ~2s, so the sweep's write was thrown away: ticking Completed on and off
// quickly left Completed On stamped with Completed off. Now only write times this tab recorded, on its
// own clock, for values that actually CHANGED, count.
import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { dropStaleFieldWrites, noteFieldWrites, _resetFieldWrites } from "../helpers/staleSweep";

const write = (itemId, fieldId, value) => ({ _effect: "UPDATE_ITEM_FIELD", itemId, fieldId, value });
const occ = (id, fields, extra = {}) => ({ id, fields, ...extra });

beforeEach(() => _resetFieldWrites());

describe("dropStaleFieldWrites", () => {
  it("drops a write to a field this tab saw change after the sweep began", () => {
    noteFieldWrites("tile", occ("tile", { rate: { value: 50 } }), occ("tile", { rate: { value: 0 } }), 2000);
    expect(dropStaleFieldWrites([write("tile", "rate", 50)], 1000)).toEqual([]);
  });

  it("keeps a write to a field that last changed before the sweep began (the control)", () => {
    noteFieldWrites("tile", occ("tile", { rate: { value: 50 } }), occ("tile", { rate: { value: 0 } }), 500);
    expect(dropStaleFieldWrites([write("tile", "rate", 9)], 1000)).toHaveLength(1);
  });

  it("ignores the server's clock: a stored stamp in the future does not make a sweep stale", () => {
    // The field was written by this tab at 900 (before the sweep); the server's ack put 2900 on it.
    noteFieldWrites("row", occ("row", { on: { value: null } }), occ("row", { on: { value: "2026-11-04" } }), 900);
    const stamped = occ("row", { on: { value: "2026-11-04", timestamp: 2900 } }, { fieldUpdatedAt: { on: 2900 } });
    noteFieldWrites("row", occ("row", { on: { value: "2026-11-04" } }), stamped, 950); // the ack: same value
    expect(dropStaleFieldWrites([write("row", "on", null)], 1000)).toHaveLength(1);
  });

  it("a whole-map write counts only the fields whose value changed", () => {
    const before = occ("row", { done: { value: true, flow: "in" }, on: { value: "2026-11-04", flow: "replace" } });
    const after = occ("row", { done: { value: false, flow: "in" }, on: { value: "2026-11-04", flow: "replace" } });
    noteFieldWrites("row", before, after, 2000);
    expect(dropStaleFieldWrites([write("row", "on", null)], 1000)).toHaveLength(1);
    expect(dropStaleFieldWrites([write("row", "done", true)], 1000)).toEqual([]);
  });

  it("a row ARRIVING (the deferred load chunks) is not a write", () => {
    noteFieldWrites("fresh", undefined, occ("fresh", { a: { value: 1 } }), 2000);
    expect(dropStaleFieldWrites([write("fresh", "a", 2)], 1000)).toHaveLength(1);
  });

  it("a sweep whose TRIGGER field changed again after it began is superseded: all its field writes go", () => {
    // Completed ticked (the trigger, before the sweep began), then unticked while the sweep was still running.
    noteFieldWrites("row", occ("row", { done: { value: false } }), occ("row", { done: { value: true } }), 900);
    noteFieldWrites("row", occ("row", { done: { value: true } }), occ("row", { done: { value: false } }), 1300);
    const trigger = { type: "MeasureOp", occurrenceId: "row", fields: { done: true } };
    const ups = [write("row", "on", "2026-11-04"), write("tile", "count", 3)];
    expect(dropStaleFieldWrites(ups, 1000, trigger)).toEqual([]);
  });

  it("a trigger that has NOT changed since keeps the sweep's writes — the control", () => {
    noteFieldWrites("row", occ("row", { done: { value: false } }), occ("row", { done: { value: true } }), 900);
    const trigger = { type: "MeasureOp", occurrenceId: "row", fields: { done: true } };
    expect(dropStaleFieldWrites([write("row", "on", "2026-11-04")], 1000, trigger)).toHaveLength(1);
  });

  it("never touches other effects or display updates", () => {
    noteFieldWrites("tile", occ("tile", { rate: { value: 1 } }), occ("tile", { rate: { value: 2 } }), 2000);
    const ups = [{ _effect: "CREATE_ITEM", instance: {} }, { fieldId: "rate", occurrenceId: "tile", value: 0 }];
    expect(dropStaleFieldWrites(ups, 1000)).toEqual(ups);
  });
});

describe("wiring", () => {
  const src = fs.readFileSync(path.join(__dirname, "../state/bindSocketToStore.js"), "utf8");
  it("only the sliced sweep passes startedAt, and the apply step filters with it", () => {
    expect(src).toMatch(/diagDepth: _diagDepth, startedAt, trigger: transaction \}\)\)\) \};/);
    expect(src).toMatch(/if \(startedAt != null\) allUpdates = dropStaleFieldWrites\(allUpdates, startedAt, trigger\);/);
    expect((src.match(/startedAt, trigger: transaction \}\)/g) || []).length).toBe(1);
  });
  it("every local occurrence write records which fields changed, against the copy it replaces", () => {
    expect(src).toMatch(/const setLocalOcc = \(id, occ\) => \{[^}]*noteFieldWrites\(id, localOccsById\[id\] \?\? _cachedBaseOccsById\?\.\[id\], occ\)/);
  });
});
