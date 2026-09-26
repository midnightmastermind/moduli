import { describe, it, expect } from "vitest";
import { listDayColumnEveryRun, LIST_STEP_ID } from "../migrations/0369-schedule-lists-its-day-column.mjs";
const op = () => ({ steps: [{ id: "loop", type: "loop", body: [
  { id: "find", type: "action", config: { type: "FIND" } },
  { id: "if", type: "if", then: [{ id: "c", type: "action", config: { type: "CREATE", parent: "$schedPageId", itemIdVar: "$dayColId", identitySignature: "schedule:col:${$day}" } }], else: [] },
  { id: "next", type: "if", then: [] },
] }] });
describe("0369", () => {
  it("lists the column right after the find-or-create branch", () => {
    const { pipeline, changed } = listDayColumnEveryRun(op());
    expect(changed).toBe(true);
    const body = pipeline.steps[0].body;
    expect(body.map((s) => s.id)).toEqual(["find", "if", LIST_STEP_ID, "next"]);
    expect(body[2].config).toEqual({ type: "ADD_CHILD", parentId: "$schedPageId", childId: "$dayColId" });
  });
  it("is idempotent", () => {
    const once = listDayColumnEveryRun(op()).pipeline;
    expect(listDayColumnEveryRun(once).changed).toBe(false);
  });
  it("refuses a pipeline without the branch", () => {
    expect(() => listDayColumnEveryRun({ steps: [] })).toThrow(/exactly 1/);
  });
});
