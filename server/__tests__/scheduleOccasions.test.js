import { describe, it, expect } from "vitest";
import { patchPlaceDatedWork, patchBirthdays, planDays } from "../migrations/0453-schedule-occasions-and-undated-todos.mjs";

const ids = { dateFieldId: "D", timeslotFieldId: "T", scheduleFormatFieldId: "F", scheduleTypeFieldId: "ST", dueFieldId: "DUE",
  completedFieldId: "C", completedOnFieldId: "CO", occasionsTplId: "OCC", todoContainerId: "TODO", holidayTypeId: "HOL" };
const ifOn = (left, then) => ({ id: left, type: "if", condition: { operator: "AND", rules: [{ left, comparator: "IS_NOT_EMPTY", right: "" }] }, then, else: [] });
const pdw = () => ({ steps: [{ type: "loop", overExpr: "$activePeriodDates", as: "$day", body: [ifOn("$dayColId", [ifOn("$dueId", [])])] }] });
const json = (p) => JSON.stringify(p);

describe("0453 — Occasions and undated Todo copies", () => {
  it("adds the holiday pass to the day-column branch and the undated pass to the Todo branch", () => {
    const { pipeline, changed } = patchPlaceDatedWork(pdw(), ids);
    expect(changed).toBe(true);
    const dayIf = pipeline.steps[0].body[0];
    expect(json(dayIf.then.slice(1))).toContain('"meta":{"datedWork":true,"occasion":true}');
    expect(json(dayIf.then[0].then)).toContain('"meta":{"todoCopy":true}');
    expect(json(dayIf.then[0].then)).toContain('"right":"TODO"');
  });
  it("a second run changes nothing", () => {
    const once = patchPlaceDatedWork(pdw(), ids).pipeline;
    const twice = patchPlaceDatedWork(once, ids);
    expect(twice.changed).toBe(false);
    expect(json(twice.pipeline)).toBe(json(once));
  });
  it("refuses a pipeline without both branches", () => {
    expect(() => patchPlaceDatedWork({ steps: [] }, ids)).toThrow();
  });
  it("Birthdays finds the day's Occasions, not its Todo", () => {
    const p = { steps: [{ type: "action", config: { type: "FIND", itemIdVar: "$todoId", predicate: { rules: [{ left: "fields.T.value", comparator: "IS", right: "Todo" }] } } }] };
    const out = patchBirthdays(p, ids);
    expect(json(out)).toContain('"right":"OCC"');
    expect(json(out)).not.toContain('"Todo"');
  });
  it("plans an Occasions above each day's Todo and moves only birthday cards", () => {
    const occs = [
      { id: "col", parentId: "page", fields: { F: { value: "day-col" } }, occurrences: ["s1", "todo"] },
      { id: "s1", fields: { T: { value: "7:00am" } } },
      { id: "todo", fields: { T: { value: "Todo" } }, occurrences: ["b1", "task"] },
      { id: "b1", moduleId: "BDAY" }, { id: "task", moduleId: "TASK" },
      { id: "done", parentId: "page", fields: { F: { value: "day-col" } }, occurrences: ["o"] },
      { id: "o", meta: { copyLinkSource: "OCC" } },
    ];
    expect(planDays(occs, { schedulePageId: "page", ...ids, birthdayModuleId: "BDAY" }))
      .toEqual([{ colId: "col", index: 1, todoId: "todo", cards: ["b1"] }]);
  });
});
