// 0387 — Bills Paid = completed Pay Bills dated in the month on screen, through the real executor.
import { describe, it, expect } from "vitest";
import { executePipeline } from "../helpers/operationExecutor";
import { buildPaidPipeline, paidTriggers } from "../../../server/migrations/0387-bills-paid-counts-pay-bills.mjs";

const IDS = { tileId: "tile", billsPaidFieldId: "paid", payBillModuleId: "mPay", completedFieldId: "done", amountFieldId: "amt", dateFieldId: "date" };
function run(pays, extra = {}) {
  const o = { tile: { id: "tile", moduleId: "mTile", fields: {} } };
  const m = { mTile: { id: "mTile", role: "instance" }, mPay: { id: "mPay", role: "instance" }, mBill: { id: "mBill", role: "instance" } };
  pays.forEach((p, i) => { o[`p${i}`] = { id: `p${i}`, moduleId: p.mod || "mPay", meta: p.meta || {}, fields: { done: { value: p.done }, amt: { value: p.amt }, date: { value: p.date } } }; });
  const ctx = { state: { grid: { _id: "g" }, gridId: "g", userId: "u", fields: [], modules: Object.values(m), occurrencesById: o, modulesById: m, fieldsById: {}, operations: [] }, fieldsById: {}, occurrencesById: o, modulesById: m, operationsById: {}, operations: [] };
  const out = executePipeline({ id: "op", name: "Paid", pipeline: buildPaidPipeline(IDS) }, ctx, { type: "LoadOp" }, { $activeDate: "2026-10-03", ...extra });
  const fx = Array.isArray(out) ? out : (out?.effects || out?.updates || []);
  return fx.find((e) => e.fieldId === "paid")?.value;
}
describe("Bills Paid (0387)", () => {
  it("sums completed Pay Bills dated in the month — the 1st included, last month and unpaid not", () => {
    expect(run([
      { done: true, amt: 24, date: "2026-10-02" },
      { done: true, amt: 10, date: "2026-10-01" },
      { done: true, amt: 99, date: "2026-09-30" },
      { done: false, amt: 50, date: "2026-10-05" },
    ])).toBe(34);
  });
  it("a ticked BILL (not a Pay Bill) no longer counts", () => {
    expect(run([{ mod: "mBill", done: true, amt: 24, date: "2026-10-02" }])).toBe(0);
  });
  it("triggers: the bill's Day goes, a Pay Bill's Completed and Date come in", () => {
    const t = paidTriggers([{ eventType: "onChange", targetId: "day", priority: 6 }, { eventType: "onChange", targetId: "amt", priority: 6 }], { dayFieldId: "day", completedFieldId: "done", dateFieldId: "date" });
    expect(t.map((x) => x.targetId)).toEqual(["amt", "done", "date"]);
  });
});
