// 0367 — "People: Birthdays" drives the REAL executor: a person born on the
// Schedule's day gets one "Birthday - Name - turns N" card in that day's Todo.
import { describe, it, expect } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";
import { buildBirthdayPipeline } from "../../../server/migrations/0367-birthdays-into-schedule-todo.mjs";

const IDS = { schedPageId: "page", peopleContId: "people", birthdayFieldId: "bday", peopleFieldId: "who",
  dateFieldId: "date", formatFieldId: "fmt", timeslotFieldId: "slot" };

function run({ people, todoKids = [] }) {
  const occurrencesById = {
    page: { id: "page", moduleId: "m-page", occurrences: ["col"], fields: {} },
    col: { id: "col", moduleId: "m-col", parentId: "page", occurrences: ["todo"], fields: { fmt: { value: "day-col" }, date: { value: "2026-09-26" } } },
    todo: { id: "todo", moduleId: "m-todo", parentId: "col", occurrences: todoKids.map((k) => k.id), fields: { slot: { value: "Todo" } } },
    people: { id: "people", moduleId: "m-people", occurrences: people.map((p) => p.id), fields: {} },
  };
  const modulesById = {
    "m-page": { id: "m-page", role: "page", label: "Schedule" }, "m-col": { id: "m-col", role: "container", label: "Col" },
    "m-todo": { id: "m-todo", role: "container", label: "Todo" }, "m-people": { id: "m-people", role: "container", label: "People" },
  };
  for (const p of people) {
    occurrencesById[p.id] = { id: p.id, moduleId: `m-${p.id}`, parentId: "people", fields: { bday: { value: p.bday } } };
    modulesById[`m-${p.id}`] = { id: `m-${p.id}`, role: "instance", label: p.name };
  }
  for (const k of todoKids) {
    occurrencesById[k.id] = { id: k.id, moduleId: "m-b", parentId: "todo", label: k.label, fields: {} };
    modulesById["m-b"] = { id: "m-b", role: "instance", label: "Birthday" };
  }
  const ctx = { state: { grid: { _id: "g" }, gridId: "g", userId: "u", fields: [], modules: Object.values(modulesById), occurrencesById, modulesById, fieldsById: {}, operations: [] },
    fieldsById: {}, occurrencesById, modulesById, operationsById: {}, operations: [] };
  const out = executePipeline({ id: "op", name: "People: Birthdays", pipeline: buildBirthdayPipeline(IDS) }, ctx,
    { type: "NavigationOp" }, { $activePeriodDates: ["2026-09-26"] });
  const effects = Array.isArray(out) ? out : (out?.effects || out?.updates || []);
  const creates = effects.filter((e) => e._effect === "CREATE_ITEM" || e.type === "CREATE_ITEM" || e.occurrence?.parentId === "todo");
  const labels = effects.map((e) => e.label ?? e.value).filter((v) => typeof v === "string" && v.startsWith("Birthday -"));
  return { effects, creates, labels };
}

describe("People: Birthdays", () => {
  it("a person born on the day gets a card with their age; others get none", () => {
    const { labels } = run({ people: [
      { id: "mark", name: "Mark", bday: "1982-09-26" },
      { id: "ann", name: "Ann", bday: "1990-10-01" },
    ] });
    expect(labels).toEqual(["Birthday - Mark - turns 44"]);
  });
  it("no known year (1900) → no age", () => {
    expect(run({ people: [{ id: "jo", name: "Jo", bday: "1900-09-26" }] }).labels).toEqual(["Birthday - Jo"]);
  });
  it("does not add the same card twice", () => {
    const { labels } = run({ people: [{ id: "mark", name: "Mark", bday: "1982-09-26" }],
      todoKids: [{ id: "old", label: "Birthday - Mark - turns 44" }] });
    expect(labels).toEqual([]);
  });
});
