// A trigger's priority must be AUTHORABLE, and a stored one must be DISPLAYABLE.
//
// `runMatchingOperations` sorts matched ops on `triggerObject.priority ?? 5`
// ascending, so the number is a plain sort key — and 0 is load-bearing on live
// data. The executor's own `_LIVEOCCS_MUTATING` comment records the failure it
// prevents: `Grid: Snap Filter To Today` (priority 0) moves each page's date on
// the first load of a new day and `Schedule: Build Schedule` (priority 1) reads
// that date in the SAME sweep; with the ordering wrong, "today's column was not
// created until the NEXT load".
//
// The editor's select offered P1..P10. Measured across every grid 2026-09-28:
//
//     priority 0   4 triggers   Grid: Snap Filter To Today · Schedule: Stamp
//                               Completed On, on poms grid and test grid 2
//     1..10     1,359 triggers
//
// So those 4 could not be written, and could not even be shown: a `<select>`
// whose value is absent from its options renders blank.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { TRIGGER_PRIORITIES, DEFAULT_TRIGGER_PRIORITY, priorityOptions } from "../helpers/triggerTypes";

const SRC = fs.readFileSync(path.resolve(__dirname, "../ui/commandCenter/OperationsTab.jsx"), "utf8");

describe("trigger priority catalog", () => {
  it("offers 0 — the priority live operations actually use", () => {
    expect(TRIGGER_PRIORITIES).toContain(0);
  });

  it("offers the whole 0..10 band with no gaps", () => {
    expect(TRIGGER_PRIORITIES).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("defaults to the value the executor's sort defaults to", () => {
    // operationExecutor: `a.match.triggerObject?.priority ?? 5`
    expect(DEFAULT_TRIGGER_PRIORITY).toBe(5);
  });
});

describe("priorityOptions", () => {
  it("returns the catalog for a value it already carries", () => {
    expect(priorityOptions(0)).toEqual(TRIGGER_PRIORITIES);
    expect(priorityOptions(3)).toEqual(TRIGGER_PRIORITIES);
  });

  it("returns the catalog when nothing is stored", () => {
    // An absent priority falls back to the default in the editor's `value`.
    expect(priorityOptions(undefined)).toEqual(TRIGGER_PRIORITIES);
    expect(priorityOptions(null)).toEqual(TRIGGER_PRIORITIES);
  });

  it("adds a stored value the catalog lacks, in sort order", () => {
    // Otherwise the select renders blank and a save silently rewrites it.
    expect(priorityOptions(12)).toEqual([...TRIGGER_PRIORITIES, 12]);
    expect(priorityOptions(-3)).toEqual([-3, ...TRIGGER_PRIORITIES]);
  });

  it("does not duplicate a stored value it already offers", () => {
    expect(priorityOptions(10).filter((n) => n === 10)).toHaveLength(1);
  });
});

describe("the editor reads the catalog", () => {
  it("builds its priority options from priorityOptions, not a literal list", () => {
    expect(SRC).toMatch(/priorityOptions\(trigObj\.priority\)\.map/);
    // The shipped state; a literal band cannot carry a stored value.
    expect(SRC).not.toMatch(/\[1,2,3,4,5,6,7,8,9,10\]\.map/);
  });

  it("shows the shared default when a trigger stores no priority", () => {
    expect(SRC).toMatch(/value=\{trigObj\.priority \?\? DEFAULT_TRIGGER_PRIORITY\}/);
  });

  it("still has a priority control at all", () => {
    // Control: "no literal 1..10 list" is equally satisfied by deleting it.
    expect(SRC).toMatch(/Priority for this trigger/);
    expect(SRC).toMatch(/updateTriggerObject\(idx, \{ priority: Number/);
  });
});
