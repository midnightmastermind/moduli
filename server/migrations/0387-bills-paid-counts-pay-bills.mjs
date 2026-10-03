// server/migrations/0387-bills-paid-counts-pay-bills.mjs
//
// "Bills Paid" counted a BILL whose own Completed was ticked — DigitalOcean read
// "paid" from August on, every month. Each month now gets its own Pay Bill
// (0384), so the user's answer (2026-10-03): "Paid Pay Bills this month" — the
// Amount of every completed Pay Bill whose Date is in the month on screen
// (`$activeDate`). The bill itself is no longer ticked, so "Bills: Mark Paid"
// is deleted.

export const id = "0387-bills-paid-counts-pay-bills";
export const describe = "Bills: Paid This Month sums completed Pay Bills dated in the month on screen; deletes Bills: Mark Paid.";
export const touches = ["operations"];

const r = (left, comparator, right) => ({ left, comparator, right });

/** PURE. */
export function buildPaidPipeline({ tileId, billsPaidFieldId, payBillModuleId, completedFieldId, amountFieldId, dateFieldId }) {
  return {
    sources: [],
    steps: [
      { id: "bp-tile", type: "action", config: { type: "INIT_VAR", name: "$tile", expr: `$allItemsById.${tileId}` } },
      { id: "bp-acc", type: "action", config: { type: "INIT_VAR", name: "$paid", value: 0 } },
      { id: "bp-loop", type: "loop", overExpr: "$allInstances", as: "$item", body: [
        { id: "bp-if", type: "if", condition: { operator: "AND", rules: [
          r("$item.templateId", "IS", payBillModuleId),
          r("$item.meta.feedSourceId", "IS_EMPTY", ""),
          r(`$item.fields.${completedFieldId}.value`, "IS", true),
          r(`$item.fields.${amountFieldId}.value`, "IS_NOT_EMPTY", ""),
          r(`$item.fields.${dateFieldId}.value`, "SAME_MONTH", "$activeDate"),
        ] }, then: [
          { id: "bp-add", type: "action", config: { type: "ADD_TO_VAR", name: "$paid", expr: `$item.fields.${amountFieldId}.value` } },
        ], else: [] },
      ] },
      { id: "bp-upd", type: "action", config: { type: "UPDATE", path: `$tile.fields.${billsPaidFieldId}.value`, value: "$paid" } },
    ],
  };
}

/** PURE. A Pay Bill's Completed or Date decides it now, not the bill's Day. */
export function paidTriggers(triggers, { dayFieldId, completedFieldId, dateFieldId }) {
  const kept = (triggers || []).filter((t) => t.targetId !== dayFieldId);
  const p = kept[0]?.priority ?? 6;
  for (const fid of [completedFieldId, dateFieldId]) if (!kept.some((t) => t.eventType === "onChange" && t.targetId === fid)) kept.push({ eventType: "onChange", subjectType: "field", targetId: fid, priority: p });
  return kept;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation, Field, Module, Grid } = models;
  const grid = await Grid.findById(gridId).lean();
  const fields = await Field.find({ gridId }).lean();
  const one = (name, type) => { const h = fields.filter((f) => f.name === name && (!type || f.type === type)); return h.length === 1 ? h[0].id : null; };
  const paid = await Operation.findOne({ gridId, name: "Bills: Paid This Month" }).lean();
  const markPaid = await Operation.findOne({ gridId, name: "Bills: Mark Paid" }).lean();
  const billFieldId = one("Bill", "occurrence");
  const payMods = await Module.find({ gridId, role: "instance", "fieldBindings.fieldId": billFieldId }).lean();
  const tileExpr = paid?.pipeline?.steps?.find((s) => s.config?.name === "$tile")?.config?.expr || "";
  const ids = {
    tileId: tileExpr.startsWith("$allItemsById.") ? tileExpr.slice("$allItemsById.".length) : null,
    billsPaidFieldId: one("Bills Paid", "number"), payBillModuleId: payMods.length === 1 ? payMods[0].id : null,
    completedFieldId: one("Completed", "boolean"), amountFieldId: one("Amount", "number"),
    dateFieldId: grid?.meta?.scheduleFieldIds?.dateFieldId, dayFieldId: one("Day", "number"),
  };
  const missing = Object.entries(ids).filter(([, v]) => !v).map(([k]) => k);
  if (!paid || missing.length) throw new Error(`0387: cannot resolve ${!paid ? "the operation " : ""}${missing.join(", ")}`);
  log(`update "Bills: Paid This Month" (tile ${ids.tileId}, Pay Bill module ${ids.payBillModuleId})`);
  log(markPaid ? `delete "Bills: Mark Paid"` : `"Bills: Mark Paid" already gone`);
  if (dryRun) return;
  await Operation.updateOne({ gridId, id: paid.id }, { $set: { pipeline: buildPaidPipeline(ids), triggerObjects: paidTriggers(paid.triggerObjects, ids) } });
  if (markPaid) await Operation.deleteOne({ gridId, id: markPaid.id });
  log("done. Restart the server (pm2).");
}
