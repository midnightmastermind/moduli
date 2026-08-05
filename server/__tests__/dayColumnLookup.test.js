// Guards migration 0039's selector: it must rewrite the two day-column lookups
// and nothing else. The bug it fixes is that `$allContainers` role-filters
// through the MODULE, so a column whose module is missing is invisible to the
// existence check and gets minted a second time.
import { describe, it, expect } from "vitest";
import { patchColumnLookups } from "../migrations/0039-day-column-lookup-drops-role-filter.mjs";
import { makeDayPageBuildOp } from "../utils/liveSystemBuilders.js";

const BOARD = "BOARD";

/** The shape the op had BEFORE the builder fix — both lookups role-filtered. */
function legacyPipeline() {
  return {
    steps: [
      { type: "loop", overExpr: "$activePeriodDates", as: "$day", body: [
        { type: "action", config: {
          type: "FIND", over: "$allContainers",
          predicate: { operator: "AND", rules: [
            { left: "parentId", comparator: "IS", right: BOARD },
            { left: "fields.DF.value", comparator: "SAME_DAY", right: "$day" },
          ]},
        }},
        { type: "if", then: [
          { type: "action", config: {
            type: "FIND", over: "$allContainers",
            predicate: { operator: "AND", rules: [{ left: "id", comparator: "IS", right: "$colId" }] },
          }},
        ], else: [] },
        // A DIFFERENT container FIND that must NOT be touched: the Schedule
        // day-col lookup for the Todo link.
        { type: "action", config: {
          type: "FIND", over: "$allContainers",
          predicate: { operator: "AND", rules: [
            { left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" },
            { left: "fields.SF.value", comparator: "IS", right: "day-col" },
          ]},
        }},
      ]},
    ],
  };
}

describe("0039 — day column lookup drops the role filter", () => {
  it("rewrites the existence check and the post-mint re-bind", () => {
    const p = legacyPipeline();
    expect(patchColumnLookups(p, BOARD)).toBe(2);
    const loop = p.steps[0];
    expect(loop.body[0].config.over).toBe("$allOccurrences");
    expect(loop.body[1].then[0].config.over).toBe("$allOccurrences");
  });

  it("leaves every OTHER container FIND alone", () => {
    const p = legacyPipeline();
    patchColumnLookups(p, BOARD);
    expect(p.steps[0].body[2].config.over).toBe("$allContainers");
  });

  it("is idempotent — a second run changes nothing", () => {
    const p = legacyPipeline();
    patchColumnLookups(p, BOARD);
    expect(patchColumnLookups(p, BOARD)).toBe(0);
  });

  it("is a no-op against the CURRENT builder output (the builder already ships the fix)", () => {
    const op = makeDayPageBuildOp({
      userId: "u", gridId: "g", dateFieldId: "DF", dayPageBoardOccId: BOARD,
      goalsPageOccId: "GP", schedulePageOccId: "SP", dayPageTemplateOccId: "TPL",
    });
    expect(patchColumnLookups(op.pipeline, BOARD)).toBe(0);
  });
});
