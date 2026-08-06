// `onGraphSelect` — clicking part of a graph fires an ordinary trigger.
//
// This is the piece that makes a chart DO something without the renderer
// knowing what it means. The feeling wheel records a mood because an OPERATION
// matches this event, not because the graph has any idea what an emotion is —
// the same rule that got schedule logic removed from ModuleContainer in
// 2026-06-03 and is guarded by noDomainKnowledge.test.js.
import { describe, it, expect } from "vitest";
import { EVENT_TYPES, VISIBLE_EVENT_TYPES, isEventCompatible } from "../helpers/triggerTypes";

describe("onGraphSelect is registered as a first-class trigger", () => {
  it("is in the shared EVENT_TYPES table", () => {
    const def = EVENT_TYPES.find(e => e.value === "onGraphSelect");
    expect(def).toBeTruthy();
    expect(def.transactionType).toBe("GraphSelectOp");
  });

  it("is OFFERED IN THE EDITOR — an unlisted trigger is one nobody can wire", () => {
    expect(VISIBLE_EVENT_TYPES.some(e => e.value === "onGraphSelect")).toBe(true);
  });

  it("matches a GraphSelectOp transaction", () => {
    expect(isEventCompatible("onGraphSelect", "GraphSelectOp", { occurrenceId: "occ-a" })).toBe(true);
  });

  it("does NOT match any other transaction type", () => {
    for (const t of ["MeasureOp", "OccurrenceCreateOp", "OccurrenceDeleteOp", "NavigationOp", "ButtonOp"]) {
      expect(isEventCompatible("onGraphSelect", t, {})).toBe(false);
    }
  });

  it("no OTHER event type is accidentally fired by a graph selection", () => {
    // A graph click must not double-fire someone's onChange or onAdd op.
    const others = EVENT_TYPES.filter(e => e.value !== "onGraphSelect");
    for (const e of others) {
      expect(isEventCompatible(e.value, "GraphSelectOp", {})).toBe(false);
    }
  });
});
