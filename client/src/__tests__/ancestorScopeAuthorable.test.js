// An ancestor-scoped trigger must be AUTHORABLE, not just enforceable.
//
// `matchAncestorScope` (operationExecutor) gates every trigger type whose
// transaction carries `_ancestorIds`, but the editor rendered its ancestor
// inputs for `onFilterChange` alone. Measured across every grid on 2026-09-27:
//
//     525 triggers carry an ancestor scope
//     onFilterChange 161  <- the only ones the editor could write
//     onAdd 182 · onDelete 182  = 364 across 43 operations
//
// And the scope has teeth: an UNSCOPED onAdd fires on the app's own plumbing
// (2026-09-22 — a folder-page occurrence the app minted for itself was stamped
// by a test op), so it is what keeps a tracker off every create on the grid.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isAncestorScopable, EVENT_TYPES } from "../helpers/triggerTypes";

describe("isAncestorScopable", () => {
  it("covers every event the runtime can scope", () => {
    // The list `matchAncestorScope`'s own doc comment names.
    for (const e of [
      "onChange", "onFieldChange", "onComplete", "onUncomplete",
      "onAdd", "onCreate", "onRemove", "onDelete",
      "onMove", "onReorder", "onDrop",
      "onFilterChange", "onNavigation",
    ]) {
      expect(isAncestorScopable(e), `${e} should be scopable`).toBe(true);
    }
  });

  it("refuses events whose transaction carries no ancestor data", () => {
    // Offering the control there would write a key nothing reads — the shape
    // this repo keeps finding from the other direction.
    for (const e of [
      "onLoad", "onButton", "onNodeInput", "onGraphSelect",
      "onWebhook", "onSchedule", "manual", "onModuleUpdate",
      "onPomoStart", "onPomoTick", "onPomoComplete", "onPomoStop",
    ]) {
      expect(isAncestorScopable(e), `${e} should NOT be scopable`).toBe(false);
    }
  });

  it("an unknown event is not scopable", () => {
    expect(isAncestorScopable("onSomethingNew")).toBe(false);
    expect(isAncestorScopable(undefined)).toBe(false);
  });

  it("is DERIVED from the transaction type, so a new event gets it for free", () => {
    // Every event mapping to an ancestor-enriched transaction is scopable
    // without anyone remembering to flag it. This is the property that keeps
    // the editor and the runtime from drifting again.
    const enriched = new Set(["MeasureOp", "OccurrenceCreateOp", "OccurrenceDeleteOp",
      "OccurrenceMoveOp", "OccurrenceListOp", "NavigationOp"]);
    for (const e of EVENT_TYPES) {
      const types = e.transactionTypes || (e.transactionType ? [e.transactionType] : []);
      const expected = types.some((t) => enriched.has(t));
      expect(isAncestorScopable(e.value), `${e.value}`).toBe(expected);
    }
  });
});

describe("the editor gates its ancestor inputs on the EVENT, not a hardcoded name", () => {
  const SRC = fs.readFileSync(
    path.join(__dirname, "..", "ui", "commandCenter", "OperationsTab.jsx"), "utf8"
  );

  it("does not hardcode onFilterChange as the only scopable event", () => {
    // The shipped state was `{eventType === "onFilterChange" && (` wrapping the
    // ancestorId / ancestorLabel inputs.
    expect(SRC).not.toMatch(/eventType === "onFilterChange" && \(\s*\n\s*<div[^>]*>\s*\n\s*<span[^>]*>only fire when an ancestor/);
    expect(SRC).toContain("isAncestorScopable(eventType) && (");
  });

  it("control: the inputs it gates still exist", () => {
    // "the gate is gone" also passes against a file with the feature deleted.
    expect(SRC).toContain("ancestorId");
    expect(SRC).toContain("ancestorLabel");
    expect(SRC).toContain("only fire when an ancestor matches");
  });
});
