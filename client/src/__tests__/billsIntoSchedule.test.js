// 0384 — "Bills: Into Schedule" drives the REAL executor: a bill whose Day is
// the Schedule day's day-of-month gets one Pay Bill in that day's Todo, with the
// bill selected and Completed off.
import { describe, it, expect } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";
import { buildBillsPipeline } from "../../../server/migrations/0384-bills-into-schedule.mjs";

const IDS = { schedPageId: "page", billsPageId: "bills", payBillSrcId: "paysrc", payBillModuleId: "m-pay", dayFieldId: "dayf", billFieldId: "billf",
  amountFieldId: "amt", accountFieldId: "acct", completedFieldId: "done", dateFieldId: "date", formatFieldId: "fmt", timeslotFieldId: "slot" };

function run({ bills, todoKids = [], day = "2026-10-02" }) {
  const occurrencesById = {
    page: { id: "page", moduleId: "m-page", occurrences: ["col"], fields: {} },
    col: { id: "col", moduleId: "m-col", parentId: "page", occurrences: ["todo"], fields: { fmt: { value: "day-col" }, date: { value: day } } },
    todo: { id: "todo", moduleId: "m-todo", parentId: "col", occurrences: todoKids.map((k) => k.id), fields: { slot: { value: "Todo" } } },
    bills: { id: "bills", moduleId: "m-bills", occurrences: ["cat"], fields: {} },
    cat: { id: "cat", moduleId: "m-cat", parentId: "bills", occurrences: bills.map((b) => b.id), fields: {} },
    routines: { id: "routines", moduleId: "m-cat", occurrences: ["paysrc"], fields: {} },
    paysrc: { id: "paysrc", moduleId: "m-pay", parentId: "routines", fields: { amt: { value: 20 }, done: { value: true } } },
  };
  const modulesById = {
    "m-page": { id: "m-page", role: "page", label: "Schedule" }, "m-col": { id: "m-col", role: "container", label: "Col" },
    "m-todo": { id: "m-todo", role: "container", label: "Todo" }, "m-bills": { id: "m-bills", role: "page", label: "Bills" },
    "m-cat": { id: "m-cat", role: "container", label: "Other" }, "m-pay": { id: "m-pay", role: "instance", label: "Pay Bill" },
  };
  for (const b of bills) {
    occurrencesById[b.id] = { id: b.id, moduleId: `m-${b.id}`, parentId: "cat", meta: b.meta || {}, fields: { ...(b.day !== undefined ? { dayf: { value: b.day } } : {}), amt: { value: b.amount }, done: { value: true } } };
    modulesById[`m-${b.id}`] = { id: `m-${b.id}`, role: "instance", label: b.id };
  }
  for (const k of todoKids) {
    occurrencesById[k.id] = { id: k.id, moduleId: k.mod || "m-pay", parentId: "todo", meta: k.meta ?? { copyLinkSource: "paysrc" }, fields: { ...(k.bill ? { billf: { value: k.bill } } : {}), done: { value: !!k.paid } } };
    if (k.mod) modulesById[k.mod] = { id: k.mod, role: "instance", label: "Task" };
  }
  const ctx = { state: { grid: { _id: "g" }, gridId: "g", userId: "u", fields: [], modules: Object.values(modulesById), occurrencesById, modulesById, fieldsById: {}, operations: [] },
    fieldsById: {}, occurrencesById, modulesById, operationsById: {}, operations: [] };
  const out = executePipeline({ id: "op", name: "Bills: Into Schedule", pipeline: buildBillsPipeline(IDS) }, ctx,
    { type: "NavigationOp" }, { $activePeriodDates: [day] });
  const effects = Array.isArray(out) ? out : (out?.effects || out?.updates || []);
  const made = effects.filter((e) => e._effect === "CREATE_ITEM" && e.instance?.parentId === "todo" && e.instance?.templateId === "m-pay").map((e) => e.instance);
  const deleted = effects.filter((e) => e._effect === "DELETE_ITEM").map((e) => e.itemId);
  return { effects, made, deleted };
}
const val = (occ, f) => { const c = occ.fields?.[f]; return c && typeof c === "object" && "value" in c ? c.value : c; };

describe("Bills: Into Schedule", () => {
  it("a bill on the 2nd gets a Pay Bill on Oct 2 — bill selected, amount carried, NOT completed, not linked", () => {
    const { made } = run({ bills: [{ id: "digitalocean", day: 2, amount: 24 }, { id: "internet", day: 10, amount: 65 }] });
    expect(made).toHaveLength(1);
    expect(val(made[0], "billf")).toBe("digitalocean");
    expect(val(made[0], "amt")).toBe(24);
    expect(val(made[0], "date")).toBe("2026-10-02");
    expect(val(made[0], "done")).toBe(false);          // the source and the bill are both ticked
    expect(made[0].linkedGroupId || null).toBeNull();  // ticking one month must not tick the rest
  });
  it("the day is the day of the MONTH: it fires again in November and not on the 12th or 20th", () => {
    const bills = [{ id: "digitalocean", day: 2, amount: 24 }];
    expect(run({ bills, day: "2026-11-02" }).made).toHaveLength(1);
    expect(run({ bills, day: "2026-10-12" }).made).toHaveLength(0);
    expect(run({ bills, day: "2026-10-20" }).made).toHaveLength(0);
  });
  it("a Day stored as text matches too", () => {
    expect(run({ bills: [{ id: "b", day: "2", amount: 5 }] }).made).toHaveLength(1);
  });
  it("a bill with no Day, and a feed copy of a bill, get nothing", () => {
    expect(run({ bills: [{ id: "noday", amount: 5 }, { id: "feedcopy", day: 2, amount: 5, meta: { feedSourceId: "x" } }] }).made).toHaveLength(0);
  });
  it("does not add a second Pay Bill for the same bill", () => {
    const { made, deleted } = run({ bills: [{ id: "digitalocean", day: 2, amount: 24 }], todoKids: [{ id: "old", bill: "digitalocean" }] });
    expect(made).toHaveLength(0);
    expect(deleted).toEqual([]);
  });
  it("removes an UNPAID card whose bill moved off the day; keeps a paid one and a hand-made one", () => {
    const { deleted } = run({ bills: [{ id: "moved", day: 9, amount: 5 }], todoKids: [
      { id: "stale", bill: "moved" },
      { id: "paid", bill: "moved", paid: true },
      { id: "byhand", bill: "moved", meta: {} },
    ] });
    expect(deleted).toEqual(["stale"]);
  });
  it("never touches a Todo item that is not a Pay Bill", () => {
    expect(run({ bills: [], todoKids: [{ id: "task", mod: "m-task" }] }).deleted).toEqual([]);
  });
});
