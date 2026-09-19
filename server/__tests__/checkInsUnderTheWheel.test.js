import { describe, it, expect } from "vitest";
import {
  unfileFromTasksCompleted,
  stopRelistingMoodRows,
} from "../migrations/0342-check-ins-live-under-the-emotions-wheel.mjs";

// ── FIXTURES, shaped from the LIVE pipelines ───────────────────────────────
// Both are trimmed copies of what `poms grid` actually stores, so a change in
// the real step shape breaks these rather than passing against a fiction.

const moodPipeline = () => ({
  steps: [
    { id: "i1", type: "action", actionType: "INIT_VAR", config: { name: "$placeParent", expr: "literal:" } },
    { id: "i2", type: "action", actionType: "INIT_VAR", config: { name: "$doneBoard", expr: "literal:" } },
    { id: "i3", type: "action", actionType: "INIT_VAR", config: { name: "$picked", expr: "$trigger.occurrenceId" } },
    {
      id: "outer", type: "if",
      condition: { operator: "AND", rules: [{ left: "$picked", comparator: "IS_NOT_EMPTY", right: null }] },
      then: [
        { id: "findcol", type: "action", actionType: "FIND", config: { over: "$allOccurrences", itemVar: "$col" } },
        {
          id: "todoscan-f4rkifgw", type: "loop", overExpr: "$col.occurrences", as: "$colKidId",
          body: [
            { id: "tk", type: "action", actionType: "INIT_VAR", config: { name: "$colKid", expr: "$allItemsById.${$colKidId}" } },
            {
              id: "ti", type: "if",
              condition: { operator: "AND", rules: [{ left: "$colKid.identitySignature", comparator: "IS", right: "daypage:Tasks Completed" }] },
              then: [{ id: "ts", type: "action", actionType: "SET_VAR", config: { name: "$doneBoard", expr: "$colKid" } }],
              else: [],
            },
          ],
        },
        {
          id: "placeif", type: "if",
          condition: { operator: "AND", rules: [{ left: "$doneBoard", comparator: "IS_NOT_EMPTY", right: null }] },
          then: [{ id: "p1", type: "action", actionType: "SET_VAR", config: { name: "$placeParent", expr: "$doneBoard.id" } }],
          else: [{ id: "p2", type: "action", actionType: "SET_VAR", config: { name: "$placeParent", expr: "$col.id" } }],
        },
        {
          id: "toggle", type: "if",
          condition: { operator: "OR", rules: [{ left: "$staleCheckIn", comparator: "IS_NOT_EMPTY", right: null }] },
          then: [{ id: "del", type: "action", actionType: "DELETE", config: { itemIdExpr: "$staleCheckIn.id" } }],
          else: [
            {
              id: "copy", type: "action", actionType: "COPY_LINK",
              config: { sourceId: "7L68pOC3Hi8t", parent: "$col.id", itemIdVar: "$newCheckIn" },
            },
            {
              id: "place-v72009ue", type: "if",
              condition: { operator: "AND", rules: [{ left: "$doneBoard", comparator: "IS_NOT_EMPTY", right: null }] },
              then: [{ id: "addc", type: "action", actionType: "ADD_CHILD", config: { type: "ADD_CHILD", parentId: "$doneBoard.id", childId: "$newCheckIn" } }],
              else: [],
            },
          ],
        },
      ],
      else: [],
    },
  ],
});

const tcPipeline = () => ({
  steps: [
    { id: "init", type: "action", actionType: "INIT_VAR", config: { name: "$dayDate", expr: "$activeDate" } },
    {
      id: "gate", type: "if",
      condition: { operator: "AND", rules: [{ left: "$tcContId", comparator: "IS_NOT_EMPTY", right: "" }] },
      then: [
        {
          id: "kToiUsT3v9CW", type: "loop", overExpr: "$tcCont.occurrences", as: "$kidId",
          body: [
            {
              id: "keeprule", type: "if",
              condition: {
                operator: "AND",
                rules: [
                  { left: "$kid.fields.completed.value", comparator: "IS", right: "true" },
                  { left: "$kid._boundFieldIds", comparator: "ARRAY_NOT_INCLUDES", right: "habit" },
                ],
              },
              then: [],
              else: [
                {
                  id: "moodRowsIntoTasksCompleted-spare", type: "if",
                  condition: { operator: "AND", rules: [{ left: "$kid.fields.mood.value", comparator: "IS_NOT_EMPTY", right: "" }] },
                  then: [],
                  else: [{ id: "sweep", type: "action", actionType: "REMOVE_CHILD", config: { type: "REMOVE_CHILD", parentId: "$tcContId", childId: "$kidId" } }],
                },
              ],
            },
          ],
        },
        {
          id: "AwM9JRqk2rF9", type: "loop", overExpr: "$allInstances", as: "$task",
          predicate: { operator: "AND", rules: [{ left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$schedPageId" }] },
          body: [{ id: "addtask", type: "action", actionType: "ADD_CHILD", config: { type: "ADD_CHILD", parentId: "$tcContId", childId: "$task.id" } }],
        },
        {
          id: "moodRowsIntoTasksCompleted", type: "loop", overExpr: "$allInstances", as: "$moodRow",
          predicate: { operator: "AND", rules: [{ left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$dayPageId" }] },
          body: [{ id: "moodRowsIntoTasksCompleted-add", type: "action", actionType: "ADD_CHILD", config: { type: "ADD_CHILD", parentId: "$tcContId", childId: "$moodRow.id" } }],
        },
      ],
      else: [],
    },
  ],
});

const json = (p) => JSON.stringify(p);

/** Every action step of `type`, at any depth. */
const countActions = (steps, type) => (steps || []).flatMap((s) => [
  ...((s.actionType || s.config?.type) === type ? [s] : []),
  ...countActions(s.then, type), ...countActions(s.else, type), ...countActions(s.body, type),
]);

// ── THE MOOD OP ────────────────────────────────────────────────────────────

describe("the Mood op stops filing a check-in under Tasks Completed", () => {
  it("removes the ADD_CHILD that listed it there", () => {
    const { pipeline } = unfileFromTasksCompleted(moodPipeline());
    expect(json(pipeline)).not.toContain("ADD_CHILD");
  });

  // THE CONTROL that makes the removal mean "under the wheel" rather than
  // "nowhere": the Check In is still parented to the day column, which is the
  // occurrence whose textmap renders it beneath the Emotions Wheel.
  it("still parents the check-in to the day column", () => {
    const { pipeline } = unfileFromTasksCompleted(moodPipeline());
    expect(json(pipeline)).toContain('"parent":"$col.id"');
  });

  it("removes the dead $doneBoard scan and the dead $placeParent branch", () => {
    const { removed } = unfileFromTasksCompleted(moodPipeline());
    expect(removed).toEqual({ listing: 1, scan: 1, placeBranch: 1, initVars: 2 });
  });

  it("leaves no $doneBoard or $placeParent reference behind", () => {
    const { pipeline } = unfileFromTasksCompleted(moodPipeline());
    expect(json(pipeline)).not.toContain("$doneBoard");
    expect(json(pipeline)).not.toContain("$placeParent");
  });

  // Everything the op does APART from the filing must survive — the toggle,
  // the delete, the un-pick path.
  it("keeps the rest of the pipeline", () => {
    const { pipeline } = unfileFromTasksCompleted(moodPipeline());
    const s = json(pipeline);
    expect(s).toContain("COPY_LINK");
    expect(s).toContain("DELETE");
    expect(s).toContain("$picked");
  });

  it("is idempotent — a second pass is a no-op", () => {
    const once = unfileFromTasksCompleted(moodPipeline());
    const twice = unfileFromTasksCompleted(once.pipeline);
    expect(twice.changed).toBe(0);
    expect(json(twice.pipeline)).toBe(json(once.pipeline));
  });

  // REFUSES rather than half-applying: a pipeline whose listing has already
  // been hand-removed but still carries the scan is a shape nobody designed.
  it("throws when an anchor does not match exactly once", () => {
    const p = moodPipeline();
    p.steps.push({ ...p.steps[0] });   // a second $placeParent INIT_VAR
    expect(() => unfileFromTasksCompleted(p)).toThrow(/3 dead INIT_VARs|expected 2 dead INIT_VARs/);
  });

  it("throws when something still reads $doneBoard", () => {
    const p = moodPipeline();
    p.steps.push({ id: "x", type: "action", actionType: "UPDATE", config: { path: "$doneBoard.meta.x", value: 1 } });
    expect(() => unfileFromTasksCompleted(p)).toThrow(/\$doneBoard reference survived/);
  });
});

// ── THE BUILD OP ───────────────────────────────────────────────────────────

describe("Tasks Completed stops sparing and re-listing mood rows", () => {
  it("removes 0341's re-add loop", () => {
    const { pipeline } = stopRelistingMoodRows(tcPipeline());
    expect(json(pipeline)).not.toContain("moodRowsIntoTasksCompleted");
  });

  // THE LOAD-BEARING CONTROL. Unwrapping the spare-IF must RESTORE the sweep,
  // not delete it — without it the container never cleans itself again and
  // this migration has swapped one bug for a worse one.
  it("restores the sweep the spare-IF was wrapped around", () => {
    const { pipeline } = stopRelistingMoodRows(tcPipeline());
    // Counted over STEPS, not over the JSON string: a REMOVE_CHILD step names
    // itself twice (actionType and config.type), so a string count says 2.
    const sweeps = countActions(pipeline.steps, "REMOVE_CHILD");
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0].config.parentId).toBe("$tcContId");
  });

  // The sweep has to land back in the ELSE of the keep rule — a REMOVE_CHILD
  // that survives at the wrong depth would sweep unconditionally.
  it("puts the sweep back in the keep rule's ELSE arm", () => {
    const { pipeline } = stopRelistingMoodRows(tcPipeline());
    const loop = pipeline.steps[1].then[0];
    const keep = loop.body[0];
    expect(keep.id).toBe("keeprule");
    expect(keep.else).toHaveLength(1);
    expect(keep.else[0].actionType).toBe("REMOVE_CHILD");
  });

  it("keeps the completed-task ADD loop", () => {
    const { pipeline } = stopRelistingMoodRows(tcPipeline());
    expect(json(pipeline)).toContain("AwM9JRqk2rF9");
    expect(json(pipeline)).toContain('"childId":"$task.id"');
  });

  it("is idempotent — a second pass is a no-op", () => {
    const once = stopRelistingMoodRows(tcPipeline());
    const twice = stopRelistingMoodRows(once.pipeline);
    expect(twice.changed).toBe(0);
    expect(json(twice.pipeline)).toBe(json(once.pipeline));
  });

  it("throws when 0341's anchors do not match exactly once", () => {
    const p = tcPipeline();
    p.steps[1].then.push({ id: "moodRowsIntoTasksCompleted", type: "loop", body: [] });
    expect(() => stopRelistingMoodRows(p)).toThrow(/expected exactly 1 moodRowsIntoTasksCompleted loop/);
  });
});
