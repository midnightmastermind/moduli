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
        // The Daily Question lookup. It uses $colId as an ANCESTOR SCOPE, not
        // as an id lookup — and `isRebind` only tests for the STRING
        // `"right":"$colId"`, so this matches too. Its absence from this
        // fixture is exactly why "and nothing else" read as true for two days
        // while the migration was patching three.
        { type: "action", config: {
          type: "FIND", over: "$allContainers",
          predicate: { operator: "AND", rules: [
            { left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$colId" },
            { left: "identitySignature", comparator: "IS", right: "daypage:Daily Question/question" },
          ]},
        }},
      ]},
    ],
  };
}

describe("0039 — day column lookup drops the role filter", () => {
  it("rewrites the existence check and the post-mint re-bind", () => {
    const p = legacyPipeline();
    const loop = p.steps[0];
    patchColumnLookups(p, BOARD);
    expect(loop.body[0].config.over).toBe("$allOccurrences");
    expect(loop.body[1].then[0].config.over).toBe("$allOccurrences");
  });

  // Pinned as what it ACTUALLY does, not what its header claimed. The Daily
  // Question FIND mentions $colId, so the `"right":"$colId"` string test matches
  // it. Recorded rather than tightened: 0039 has already run against poms grid,
  // and a migration file has to describe what executed. The BUILDER now emits
  // $allOccurrences there directly, so this over-match is a no-op on a fresh seed.
  it("ALSO rewrites the Daily Question lookup — it mentions $colId (3, not 2)", () => {
    const p = legacyPipeline();
    expect(patchColumnLookups(p, BOARD)).toBe(3);
    expect(p.steps[0].body[3].config.over).toBe("$allOccurrences");
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

  // The regression this pair actually protects: a Daily Question FIND on the
  // role-filtered collection binds nothing when the container's MODULE is
  // missing from the store, the `$dqId IS_NOT_EMPTY` gate fails, and the day's
  // question is silently never filled — the "14 containers, 12 EMPTY" state
  // measured on poms grid. Asserting it straight from the builder means a
  // reseeded grid cannot regress to the shape poms grid was migrated out of.
  it("the builder's Daily Question lookup is NOT role-filtered", () => {
    const op = makeDayPageBuildOp({
      userId: "u", gridId: "g", dateFieldId: "DF", dayPageBoardOccId: BOARD,
      goalsPageOccId: "GP", schedulePageOccId: "SP", dayPageTemplateOccId: "TPL",
      journalQuestionFieldId: "JQ", questionPoolModuleId: "POOL",
    });
    const finds = [];
    const walk = (steps) => {
      for (const s of steps || []) {
        if (s?.config?.type === "FIND") finds.push(s.config);
        walk(s?.body); walk(s?.then); walk(s?.else);
      }
    };
    walk(op.pipeline.steps);
    const dq = finds.find(f =>
      JSON.stringify(f.predicate || {}).includes("daypage:Daily Question/question"));
    expect(dq, "the Daily Question FIND should exist when the op is built with question context").toBeTruthy();
    expect(dq.over).toBe("$allOccurrences");
  });

  // And with no question context the FIND must not be emitted at all — the op
  // is built both ways (grids without a question pool), so "it is absent" and
  // "it is wrong" must stay distinguishable.
  it("emits no Daily Question lookup when the op is built without question context", () => {
    const op = makeDayPageBuildOp({
      userId: "u", gridId: "g", dateFieldId: "DF", dayPageBoardOccId: BOARD,
      goalsPageOccId: "GP", schedulePageOccId: "SP", dayPageTemplateOccId: "TPL",
    });
    expect(JSON.stringify(op.pipeline)).not.toContain("daypage:Daily Question/question");
  });
});
