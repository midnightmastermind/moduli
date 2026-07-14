/*
 * Baseline smoke test for operation trigger dispatch
 * Run: npm --prefix ./client run test -- operationsSmoke
 *
 * Baseline Results (Apr 18 2026):
 * ✓ matches onFieldChange when a MeasureOp arrives
 * ✓ matches onFilterChange when a NavigationOp arrives
 * ✓ still matches onLoad when transactionType is null
 *
 * All 3 tests PASS. This is the expected baseline — shouldTrigger already
 * implements the full trigger dispatch logic. Task A0 establishes this
 * baseline; Task A1 will address any integration gaps (if operations don't
 * actually fire despite shouldTrigger returning true).
 */

import { describe, it, expect } from "vitest";
import { shouldTrigger } from "../helpers/operationExecutor";

const baseOp = {
  id: "op_water_today",
  enabled: true,
  name: "Water Today",
  sortOrder: 10,
  triggerTypes: ["onFieldChange", "onLoad", "onFilterChange"],
  triggerConfig: {},
  pipeline: { sources: [], steps: [] },
};

describe("operation trigger dispatch", () => {
  it("matches onFieldChange when a MeasureOp arrives", () => {
    expect(shouldTrigger(baseOp, "MeasureOp", { fieldId: "water", instanceId: "inst1" })).toBe(true);
  });

  it("matches onFilterChange when a NavigationOp arrives", () => {
    expect(shouldTrigger(baseOp, "NavigationOp", { activeFilterValues: { date: "2026-04-18" } })).toBe(true);
  });

  it("still matches onLoad when transactionType is null", () => {
    expect(shouldTrigger(baseOp, null, null)).toBe(true);
  });
});
