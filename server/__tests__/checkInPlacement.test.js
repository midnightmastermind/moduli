// 0339's planners. The BEHAVIOURAL half — that the retargeted pipeline actually
// files a click's check-in under Tasks Completed — runs the real executor in
// `client/src/__tests__/moodCheckInPlacement.test.js`; this pins the transform
// and the one-off move of the rows already filed under a Todo.
import { describe, it, expect } from "vitest";
import { retargetPlacement, planCheckInMoves, findCopyLinkSource }
  from "../migrations/0339-a-check-in-belongs-under-tasks-completed.mjs";

const TS = "fld-timeslot";
const SIG = "daypage:Tasks Completed";

const todoTest = () => ({
  id: "if-todo", type: "if",
  condition: { operator: "AND", rules: [{ left: `$todoKid.fields.${TS}.value`, comparator: "IS", right: "Todo" }] },
  then: [{ id: "set", type: "action", actionType: "SET_VAR", config: { name: "$todo", expr: "$todoKid" } }],
  else: [],
});
const livePipeline = () => ({
  sources: [],
  steps: [
    { id: "init", type: "action", actionType: "INIT_VAR", config: { name: "$todo", expr: "literal:" } },
    { id: "loop", type: "loop", overExpr: "$col.occurrences", as: "$todoKidId", body: [
      { id: "kid", type: "action", actionType: "INIT_VAR",
        config: { name: "$todoKid", expr: "$allItemsById.${$todoKidId}" } },
      todoTest(),
    ] },
    { id: "add", type: "if",
      condition: { operator: "AND", rules: [{ left: "$todo", comparator: "IS_NOT_EMPTY", right: null }] },
      then: [{ id: "ac", type: "action", actionType: "ADD_CHILD",
        config: { parentId: "$todo.id", childId: "$newCheckIn" } }],
      else: [] },
  ],
});

describe("0339 retargetPlacement", () => {
  it("reads the day-page identity signature instead of a Time Slot value", () => {
    const { pipeline } = retargetPlacement(livePipeline(), { doneSignature: SIG, timeslotFieldId: TS });
    const rules = pipeline.steps[1].body[1].condition.rules;
    expect(rules).toEqual([{ left: "$colKid.identitySignature", comparator: "IS", right: SIG }]);
  });

  it("renames every $todo var, so nothing is left calling the Completed board a Todo", () => {
    const { pipeline, renamed } = retargetPlacement(livePipeline(), { doneSignature: SIG, timeslotFieldId: TS });
    expect(JSON.stringify(pipeline)).not.toContain("$todo");
    expect(pipeline.steps[1].as).toBe("$colKidId");
    expect(pipeline.steps[2].then[0].config.parentId).toBe("$doneBoard.id");
    expect(renamed.$todoKidId).toBe(2);
  });

  it("keeps the loop's variable and its binder in step — the longest-first rule", () => {
    // `$todoKidId` rewritten by the `$todoKid` pass would leave the loop
    // binding `$colKidIdId` while the body read `$colKidId`: a loop that
    // iterates and resolves nothing.
    const { pipeline } = retargetPlacement(livePipeline(), { doneSignature: SIG, timeslotFieldId: TS });
    expect(pipeline.steps[1].body[0].config.expr).toBe("$allItemsById.${$colKidId}");
  });

  it("THROWS when the Todo test is gone — a silent no-op is the failure mode", () => {
    const p = livePipeline();
    p.steps[1].body = [p.steps[1].body[0]];
    expect(() => retargetPlacement(p, { doneSignature: SIG, timeslotFieldId: TS })).toThrow(/found 0/);
  });

  it("THROWS rather than retargeting twice", () => {
    const once = retargetPlacement(livePipeline(), { doneSignature: SIG, timeslotFieldId: TS }).pipeline;
    expect(() => retargetPlacement(once, { doneSignature: SIG, timeslotFieldId: TS })).toThrow(/found 0/);
  });

  it("leaves a Time Slot test on some OTHER variable alone", () => {
    const p = livePipeline();
    p.steps.push({ id: "other", type: "if",
      condition: { operator: "AND", rules: [{ left: `$slot.fields.${TS}.value`, comparator: "IS", right: "Todo" }] },
      then: [], else: [] });
    const { pipeline } = retargetPlacement(p, { doneSignature: SIG, timeslotFieldId: TS });
    expect(pipeline.steps[3].condition.rules[0].left).toBe(`$slot.fields.${TS}.value`);
  });
});

describe("0339 findCopyLinkSource", () => {
  it("reads the Check In source the op names, however deeply nested", () => {
    const p = { steps: [{ type: "if", then: [{ type: "loop", body: [
      { type: "action", actionType: "COPY_LINK", config: { sourceId: "occ-checkin" } }] }], else: [] }] };
    expect(findCopyLinkSource(p)).toBe("occ-checkin");
  });
  it("returns null when the op copy-links nothing, so the caller fails closed", () => {
    expect(findCopyLinkSource({ steps: [] })).toBeNull();
  });
});

const CHECKIN = "occ-checkin-src";
const world = () => [
  { id: "col-a", moduleId: "m-col", occurrences: ["todo-a", "done-a"] },
  { id: "todo-a", moduleId: "m-todo", occurrences: ["ci-1", "task-1"] },
  { id: "done-a", moduleId: "m-done", occurrences: [] },
  { id: "ci-1", moduleId: "m-checkin", parentId: "col-a", meta: { copyLinkSource: CHECKIN } },
  { id: "task-1", moduleId: "m-task", parentId: "col-a", meta: {} },
];
const args = () => ({
  todoModuleIds: ["m-todo"],
  doneByOcc: new Map([["done-a", true]]),
  checkInSourceId: CHECKIN,
});

describe("0339 planCheckInMoves", () => {
  it("moves a check-in from the Todo to its own column's Tasks Completed", () => {
    const { moves, stranded } = planCheckInMoves(world(), args());
    expect(moves).toEqual([{ checkIn: "ci-1", from: "todo-a", to: "done-a" }]);
    expect(stranded).toEqual([]);
  });

  it("LEAVES anything that is not a check-in — the Todo's real tasks stay put", () => {
    // The discriminating case: without the copyLinkSource gate this empties
    // every Todo on the grid into Completed.
    const { moves } = planCheckInMoves(world(), args());
    expect(moves.map((m) => m.checkIn)).not.toContain("task-1");
  });

  it("strands rather than guesses when the column has no Tasks Completed", () => {
    const w = world();
    w[0].occurrences = ["todo-a"];
    const { moves, stranded } = planCheckInMoves(w, { ...args(), doneByOcc: new Map() });
    expect(moves).toEqual([]);
    expect(stranded).toEqual([{ checkIn: "ci-1", from: "todo-a", column: "col-a" }]);
  });

  it("uses the CHECK-IN's own column, not the holder's — a Todo is shared", () => {
    // The live Todo is one container listed into several columns; filing by the
    // holder would drop a Monday check-in into Tuesday's Completed.
    const w = [
      ...world(),
      { id: "col-b", moduleId: "m-col", occurrences: ["todo-a", "done-b"] },
      { id: "done-b", moduleId: "m-done", occurrences: [] },
      { id: "ci-2", moduleId: "m-checkin", parentId: "col-b", meta: { copyLinkSource: CHECKIN } },
    ];
    w[1].occurrences = ["ci-1", "ci-2"];
    const { moves } = planCheckInMoves(w, {
      ...args(), doneByOcc: new Map([["done-a", true], ["done-b", true]]),
    });
    expect(moves).toEqual([
      { checkIn: "ci-1", from: "todo-a", to: "done-a" },
      { checkIn: "ci-2", from: "todo-a", to: "done-b" },
    ]);
  });

  it("THROWS without a source id instead of matching everything that is not one", () => {
    // The dry run caught this as a plan to move nine REAL tasks into Completed:
    // a mistyped option key made `meta.copyLinkSource !== undefined` true for
    // every ordinary Todo child. A default here is a silent inversion.
    expect(() => planCheckInMoves(world(), { ...args(), checkInSourceId: undefined }))
      .toThrow(/checkInSourceId/);
  });

  it("finds nothing once the move has run — the re-run guard", () => {
    const w = world();
    w[1].occurrences = ["task-1"];
    w[2].occurrences = ["ci-1"];
    expect(planCheckInMoves(w, args()).moves).toEqual([]);
  });
});
