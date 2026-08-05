// Guards migration 0040's insertion point. The fill has to land INSIDE the
// per-day loop while `$colId` still names the day just built — anywhere else it
// either runs once for the whole sweep or resolves `$colId` to nothing.
import { describe, it, expect } from "vitest";
import { insertQuestionFill, QUESTION_SIGNATURE } from "../migrations/0040-daily-question-autofill.mjs";
import { makeDayPageBuildOp } from "../utils/liveSystemBuilders.js";

let n = 0;
const uid = () => `id${n++}`;
const args = { questionFieldId: "QF", poolModuleId: "POOL", uid };

/** The stored shape BEFORE the builder fix — no fill pass. */
function legacyPipeline() {
  return {
    steps: [
      { type: "loop", overExpr: "$activePeriodDates", as: "$day", body: [
        { type: "action", config: { type: "FIND", over: "$allOccurrences", predicate: {} } },
        { type: "if", condition: {}, then: [], else: [] },
        { type: "action", config: { type: "UPDATE", path: "$col.meta.appliedFromTemplateId", value: "$tplId" } },
        { type: "action", config: { type: "FIND", over: "$allContainers", predicate: {} } },
      ]},
    ],
  };
}

const flatten = (steps, out = []) => {
  for (const s of steps || []) {
    out.push(s);
    flatten(s.body, out); flatten(s.then, out); flatten(s.else, out);
  }
  return out;
};

describe("0040 — Daily Question fill insertion", () => {
  it("inserts the fill immediately after the template-route stamp, inside the day loop", () => {
    const p = legacyPipeline();
    expect(insertQuestionFill(p, args)).toBe(true);

    const body = p.steps[0].body;
    const anchor = body.findIndex(s => s.config?.path === "$col.meta.appliedFromTemplateId");
    expect(anchor).toBeGreaterThanOrEqual(0);
    // The FIND for the question container is the very next step — still in the
    // loop, still with $colId bound to the day that was just built.
    expect(body[anchor + 1].config.type).toBe("FIND");
    expect(body[anchor + 1].config.predicate.rules.some(r =>
      r.left === "identitySignature" && r.right === QUESTION_SIGNATURE)).toBe(true);
    expect(body[anchor + 1].config.predicate.rules.some(r =>
      r.left === "_ancestors" && r.right === "$colId")).toBe(true);
  });

  it("only writes when the question is EMPTY", () => {
    const p = legacyPipeline();
    insertQuestionFill(p, args);
    const steps = flatten(p.steps);
    const guard = steps.find(s => s.type === "if"
      && (s.condition?.rules || []).some(r => r.left === "$dq.fields.QF.value" && r.comparator === "IS_EMPTY"));
    expect(guard).toBeTruthy();
    // …and the write lives inside that guard, not beside it.
    expect(flatten(guard.then).some(s => s.config?.path === "$dq.fields.QF.value")).toBe(true);
  });

  it("is idempotent — a pipeline that already fills is left alone", () => {
    const p = legacyPipeline();
    insertQuestionFill(p, args);
    const once = JSON.stringify(p);
    expect(insertQuestionFill(p, args)).toBe(false);
    expect(JSON.stringify(p)).toBe(once);
  });

  it("no-ops on a pipeline with no template-route stamp rather than guessing", () => {
    const p = { steps: [{ type: "loop", body: [{ type: "action", config: { type: "FIND" } }] }] };
    expect(insertQuestionFill(p, args)).toBe(false);
    expect(JSON.stringify(p)).not.toContain("PICK_RANDOM_FROM_POOL");
  });

  it("the migration and the BUILDER produce the same pass — a reseed cannot drift from a migrated grid", () => {
    // The builder's version, straight from the factory.
    const built = makeDayPageBuildOp({
      userId: "u", gridId: "g", dateFieldId: "DF", dayPageBoardOccId: "BOARD",
      goalsPageOccId: "GP", schedulePageOccId: "SP", dayPageTemplateOccId: "TPL",
      journalQuestionFieldId: "QF", questionPoolModuleId: "POOL",
    });
    const migrated = legacyPipeline();
    insertQuestionFill(migrated, args);

    const shape = (pipeline) => flatten(pipeline.steps)
      .filter(s => s.config?.type === "PICK_RANDOM_FROM_POOL"
        || s.config?.path === "$dq.fields.QF.value"
        || (s.config?.type === "FIND" && JSON.stringify(s.config).includes(QUESTION_SIGNATURE)))
      .map(s => JSON.stringify(s.config, (k, v) => (k === "id" ? undefined : v)));

    expect(shape(migrated)).toEqual(shape(built.pipeline));
    expect(shape(built.pipeline).length).toBe(3);
  });
});
