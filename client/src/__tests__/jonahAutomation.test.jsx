// @vitest-environment jsdom
// Jonah's automations are real operations (2026-11-16): the server compiles a short form into an Operation, and the
// client's own executor runs it.
import { describe, it, expect, vi } from "vitest";
const toasts = vi.hoisted(() => []);
vi.mock("../state/notificationStore", async (orig) => {
  const real = await orig();
  const t = (m) => { toasts.push(m); }; Object.assign(t, { success: t, error: t, info: t, warning: t, loading: t, dismiss: () => {} });
  return { ...real, toast: t };
});
import { executePipeline } from "../helpers/operationExecutor";
import { compileAutomation, parseClock, parseDays } from "../../../server/services/automation.js";

const F = { completed: { id: "fC", name: "Completed", type: "boolean" }, on: { id: "fOn", name: "Completed On", type: "date" }, tags: { id: "fT", name: "Tags", type: "text" } };
const fields = Object.values(F);
const places = { "tasks › todo": { occId: "todo", label: "Todo" }, "routines › physical": { occId: "phys", label: "Physical" } };
const ctx = { userId: "u", gridId: "g", fields,
  findPlace: (n) => places[String(n).toLowerCase()] || places[`tasks › ${String(n).toLowerCase()}`] || null,
  findOp: (n) => (n === "Schedule: Place Dated Work" ? { id: "opPlace", name: n } : null) };

function run(op, transaction) {
  const occurrencesById = {
    todo: { id: "todo", moduleId: "mC", occurrences: ["t1"] }, phys: { id: "phys", moduleId: "mC", occurrences: [] },
    t1: { id: "t1", moduleId: "mI", parentId: "todo", fields: { fC: { value: true } } },
    other: { id: "other", moduleId: "mC", occurrences: ["t2"] }, t2: { id: "t2", moduleId: "mI", parentId: "other", fields: {} },
  };
  const modulesById = { mC: { id: "mC", role: "container", label: "Todo" }, mI: { id: "mI", role: "instance", label: "Task" } };
  const fieldsById = Object.fromEntries(fields.map((f) => [f.id, f]));
  const operationsById = { [op.id]: op };
  const ctxE = { state: { grid: { _id: "g" }, gridId: "g", fields, modules: Object.values(modulesById), occurrencesById, modulesById, fieldsById, operationsById, operations: [op] },
    fieldsById, occurrencesById, modulesById, operationsById, operations: [op] };
  const out = executePipeline(op, ctxE, transaction, {});
  return Array.isArray(out) ? out : (out?.effects || out?.updates || []);
}

describe("compileAutomation → a real operation", () => {
  it("reads times and days", () => {
    expect(parseClock("2pm")).toBe("14:00"); expect(parseClock("7:30 am")).toBe("07:30"); expect(parseClock("12am")).toBe("00:00");
    expect(parseClock("14:05")).toBe("14:05"); expect(parseClock("3")).toBe(null); expect(parseClock("25:00")).toBe(null);
    expect(parseDays("weekdays")).toEqual([1, 2, 3, 4, 5]); expect(parseDays(["Mon", "wednesday"])).toEqual([1, 3]);
    expect(parseDays("every day")).toBe(null); expect(parseDays("someday")).toBe(undefined);
  });
  it("every day at 2pm: a timed op that notifies", () => {
    const { op, problems, summary } = compileAutomation({ when: { at: "2pm" }, do: [{ notify: "Drink water" }] }, ctx);
    expect(problems).toEqual([]);
    expect(op.schedule).toMatchObject({ kind: "atTimes", times: ["14:00"] });
    expect(op.triggerObjects).toEqual([]);
    expect(summary.when).toBe("every day at 2:00pm");
    toasts.length = 0;
    run(op, { type: "ScheduledOp" });
    expect(toasts).toContain("Drink water");
  });
  it("weekdays at 9 → a when schedule", () => {
    const { op } = compileAutomation({ when: { at: "9am", days: "weekdays" }, do: [{ notify: "Standup" }] }, ctx);
    expect(op.schedule).toMatchObject({ kind: "when", when: { mode: "weekdays", days: [1, 2, 3, 4, 5], time: "09:00" } });
  });
  it("when Completed becomes true in Todo: stamps Completed On on THAT item, and only there", () => {
    const { op, problems } = compileAutomation({ when: { changed: "Completed", in: "Tasks › Todo", to: true },
      do: [{ set: "Completed On", value: "today" }, { notify: "Nice" }] }, ctx);
    expect(problems).toEqual([]);
    expect(op.triggerObjects).toEqual([{ eventType: "onChange", subjectType: "field", targetId: "fC", priority: 5 }]);
    expect(op.triggerTypes).toEqual(["onChange"]);
    const hit = run(op, { type: "MeasureOp", occurrenceId: "t1", fields: { fC: { value: true } } });
    const set = hit.find((e) => e._effect === "UPDATE_ITEM_FIELD" && e.fieldId === "fOn");
    expect(set?.itemId).toBe("t1");
    expect(set?.value).toMatch(/^\d{4}-\d{2}-\d{2}/);
    // unticked → nothing; ticked elsewhere → nothing
    expect(run(op, { type: "MeasureOp", occurrenceId: "t1", fields: { fC: { value: false } } }).filter((e) => e._effect)).toEqual([]);
    expect(run(op, { type: "MeasureOp", occurrenceId: "t2", fields: { fC: { value: true } } }).filter((e) => e._effect)).toEqual([]);
  });
  it("when an item is added to Todo: adds a row elsewhere (the trigger is 0465's shape)", () => {
    const { op } = compileAutomation({ when: { added_to: "Tasks › Todo" }, do: [{ add_item: "Stretch", to: "Routines › Physical", fields: { Tags: "$5 thing" } }] }, ctx);
    expect(op.triggerObjects).toEqual([{ eventType: "onAdd", subjectType: "module", subjectRole: "instance", targetId: "", priority: 5, ancestorId: "todo" }]);
    const fx = run(op, { type: "OccurrenceCreateOp", occurrenceId: "t1" });
    const made = fx.find((e) => e._effect === "CREATE_ITEM");
    expect(made).toBeTruthy();
    expect(JSON.stringify(made)).toContain("Stretch");
    expect(JSON.stringify(made)).toContain("phys");
    expect(JSON.stringify(made)).toContain("$5 thing");   // typed text is text, not a variable
  });
  it("names that point at nothing are problems, never guesses", () => {
    const r = compileAutomation({ when: { added_to: "Nowhere" }, do: [{ run: "Nope" }, { set: "Completed On", value: "today" }] }, ctx);
    expect(r.op).toBe(null);
    expect(r.problems.join(" | ")).toMatch(/no page or section named "Nowhere"/);
    expect(r.problems.join(" | ")).toMatch(/no operation named "Nope"/);
    const timed = compileAutomation({ when: { at: "2pm" }, do: [{ set: "Completed", value: true }] }, ctx);
    expect(timed.problems[0]).toMatch(/needs an item/);
    expect(compileAutomation({ when: {}, do: [{ notify: "x" }] }, ctx).problems[0]).toMatch(/say when/);
  });
});

describe("the approval card says what the automation is", async () => {
  const { render, screen } = await import("@testing-library/react");
  const { AutomationPreview } = await import("../ui/AssistantDrawer.jsx");
  it("names the operation, when it runs and what it does", () => {
    render(<AutomationPreview msg={{ preview: { name: "Water", when: "every day at 2:00pm", does: ['notify "Drink water"'] } }} />);
    expect(screen.getByText("Water")).toBeTruthy();
    expect(screen.getByText("every day at 2:00pm")).toBeTruthy();
    expect(screen.getByText('notify "Drink water"')).toBeTruthy();
  });
});
