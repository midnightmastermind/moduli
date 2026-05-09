import { describe, it, expect } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";

// Helper: read the last $vars snapshot from log entries. The executor logs
// `varsBefore` on each action entry — so a 2-step pipeline lets us capture
// the result of step 1 via step 2's `varsBefore`.
function lastVarsBefore(logger) {
  const withVars = logger.entries.filter(e => e.varsBefore);
  return withVars.length ? withVars[withVars.length - 1].varsBefore : null;
}

function makeLogger() {
  return { entries: [], add(kind, data) { this.entries.push({ kind, ...data }); } };
}

describe("$parentFilter resolution", () => {
  it("returns the page's filterOverride for a trigger ancestored by that page", async () => {
    const dateFieldId = "fld_date";
    const grid = {
      activeFilterValues: { [dateFieldId]: "2026-05-01" },
      namedFilters: [],
    };
    const goalsPageOcc = {
      id: "occ_goals_page",
      targetId: "mod_goals_page",
      filterOverride: { [dateFieldId]: "2026-05-23" },
      occurrences: ["occ_goal_inst"],
      fields: {},
      meta: {},
    };
    const goalInstOcc = {
      id: "occ_goal_inst",
      targetId: "mod_goal_inst",
      occurrences: [],
      fields: {},
      meta: {},
    };
    const occurrencesById = {
      occ_goals_page: goalsPageOcc,
      occ_goal_inst: goalInstOcc,
    };

    const operation = {
      id: "op_test",
      pipeline: {
        sources: [],
        steps: [
          { id: "s1", type: "action", config: { type: "INIT_VAR", name: "$result", expr: `$parentFilter.${dateFieldId}` } },
          // Marker step — its varsBefore captures s1's effect on $vars.
          { id: "s2", type: "action", config: { type: "INIT_VAR", name: "$marker", value: 1 } },
        ],
      },
    };
    const transaction = { type: "MeasureOp", occurrenceId: "occ_goal_inst" };
    const logger = makeLogger();

    await executePipeline(
      operation,
      { state: { grid, gridId: "g1", modules: [] }, modulesById: {}, occurrencesById, fieldsById: {} },
      transaction,
      undefined,
      logger,
    );

    const snap = lastVarsBefore(logger);
    expect(snap).not.toBeNull();
    expect(snap.$result).toBe("2026-05-23");
  });

  it("falls back to grid filter when trigger has no ancestor with filterOverride", async () => {
    const dateFieldId = "fld_date";
    const grid = {
      activeFilterValues: { [dateFieldId]: "2026-05-01" },
      namedFilters: [],
    };
    const looseOcc = {
      id: "occ_loose",
      targetId: "mod_x",
      occurrences: [],
      fields: {},
      meta: {},
    };
    const occurrencesById = { occ_loose: looseOcc };

    const operation = {
      id: "op_test2",
      pipeline: {
        sources: [],
        steps: [
          { id: "s1", type: "action", config: { type: "INIT_VAR", name: "$result", expr: `$parentFilter.${dateFieldId}` } },
          { id: "s2", type: "action", config: { type: "INIT_VAR", name: "$marker", value: 1 } },
        ],
      },
    };
    const logger = makeLogger();

    await executePipeline(
      operation,
      { state: { grid, gridId: "g1", modules: [] }, modulesById: {}, occurrencesById, fieldsById: {} },
      { type: "MeasureOp", occurrenceId: "occ_loose" },
      undefined,
      logger,
    );

    const snap = lastVarsBefore(logger);
    expect(snap).not.toBeNull();
    expect(snap.$result).toBe("2026-05-01");
  });

  it("honours the trigger occurrence's own filterOverride (page-level filter change)", async () => {
    // Regression: when a page's own filter changes, the source NavigationOp's
    // trigger.occurrenceId is the page itself. $parentFilter must include the
    // page's filterOverride — otherwise the source fire computes against grid
    // filters while descendant fires compute against the new override, producing
    // a flicker (today → tomorrow → today).
    const dateFieldId = "fld_date";
    const grid = {
      activeFilterValues: { [dateFieldId]: "2026-05-01" },
      namedFilters: [],
    };
    const goalsPageOcc = {
      id: "occ_goals_page",
      targetId: "mod_goals_page",
      filterOverride: { [dateFieldId]: "2026-05-23" },
      occurrences: [],
      fields: {},
      meta: {},
    };
    const occurrencesById = { occ_goals_page: goalsPageOcc };

    const operation = {
      id: "op_test3",
      pipeline: {
        sources: [],
        steps: [
          { id: "s1", type: "action", config: { type: "INIT_VAR", name: "$result", expr: `$parentFilter.${dateFieldId}` } },
          { id: "s2", type: "action", config: { type: "INIT_VAR", name: "$marker", value: 1 } },
        ],
      },
    };
    const logger = makeLogger();

    await executePipeline(
      operation,
      { state: { grid, gridId: "g1", modules: [] }, modulesById: {}, occurrencesById, fieldsById: {} },
      { type: "NavigationOp", occurrenceId: "occ_goals_page" },
      undefined,
      logger,
    );

    const snap = lastVarsBefore(logger);
    expect(snap).not.toBeNull();
    expect(snap.$result).toBe("2026-05-23");
  });
});
