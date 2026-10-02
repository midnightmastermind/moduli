// server/migrations/0384-bills-into-schedule.mjs
//
// "Bills: Into Schedule" — every day the Schedule builds, each bill on the Bills
// page whose `Day` (the day of the month it recurs on, 1-31) is that day gets a
// "Pay Bill" occurrence in THAT day's Todo, with the bill selected and
// Completed off (user, 2026-10-02: "takes bills, checks its reoccurance day …
// and add a copy to my schedule on the given day" → "make it a pay bill
// occurance added to schedule with that bill selected and completed set to
// off" · "dont use due date cause its suppose to be a 1-30 thing").
//
//   which bills   an instance under the Bills page with a `Day` value
//   which day     DATE_FORMAT(day, "d") IS the bill's Day — the day of the
//                 month only; `Next Due` / `Due` are not read
//   the card      a copy of the Routines "Pay Bill" item (same module, NOT a
//                 linked copy — ticking one must not tick the others) with
//                 Bill = the bill, Amount and Account from the bill, Date = the
//                 day, Completed = false
//
// Same triggers and day list as "People: Birthdays" (0367): grid load and
// filter changes over `$activePeriodDates`, at a later priority than "Schedule:
// Build Schedule" so the day's column and Todo exist. It also re-runs when a
// bill is added or deleted or its Day / Amount changes. Idempotent: a Pay Bill
// for that bill already in that Todo is left alone; an unpaid one this op made
// whose bill no longer falls on the day (Day changed or cleared) is removed.
// A paid one is never removed.

export const id = "0384-bills-into-schedule";
export const describe = "Creates the 'Bills: Into Schedule' operation: each Schedule day, every bill whose Day is that day of the month gets a Pay Bill occurrence (bill selected, not completed) in the day's Todo.";
export const touches = ["operations"];

export const OP_NAME = "Bills: Into Schedule";

const r = (left, comparator, right) => ({ left, comparator, right });
const and = (...rules) => ({ operator: "AND", rules });
const act = (id, config) => ({ id, type: "action", config });

/** PURE. The pipeline, given the ids it needs. */
export function buildBillsPipeline({ schedPageId, billsPageId, payBillSrcId, payBillModuleId, dayFieldId, billFieldId, amountFieldId, accountFieldId, completedFieldId, dateFieldId, formatFieldId, timeslotFieldId }) {
  const DAY = `$bill.fields.${dayFieldId}.value`;
  return {
    sources: [],
    steps: [
      act("bs-page", { type: "INIT_VAR", name: "$schedPageId", expr: `literal:${schedPageId}` }),
      { id: "bs-days", type: "loop", overExpr: "$activePeriodDates", as: "$day", body: [
        act("bs-col0", { type: "INIT_VAR", name: "$dayColId", expr: "literal:" }),
        act("bs-col", { type: "FIND", over: "$allContainers", itemIdVar: "$dayColId", predicate: and(
          r("_ancestors", "HAS_ANCESTOR", "$schedPageId"),
          r(`fields.${formatFieldId}.value`, "IS", "day-col"),
          r(`fields.${dateFieldId}.value`, "SAME_DAY", "$day"),
        ) }),
        { id: "bs-hascol", type: "if", condition: and(r("$dayColId", "IS_NOT_EMPTY", "")), then: [
          act("bs-todo0", { type: "INIT_VAR", name: "$todoId", expr: "literal:" }),
          act("bs-todo", { type: "FIND", over: "$allContainers", itemIdVar: "$todoId", predicate: and(
            r("_ancestors", "HAS_ANCESTOR", "$dayColId"),
            r(`fields.${timeslotFieldId}.value`, "IS", "Todo"),
          ) }),
          { id: "bs-hastodo", type: "if", condition: and(r("$todoId", "IS_NOT_EMPTY", "")), then: [
            // The day of the month, as the bill's Day stores it (2, not 02).
            act("bs-dom", { type: "DATE_FORMAT", date: "$day", format: "d", to: "$dayOfMonth" }),
            // Every bill that SHOULD have a card this day; an unpaid card for
            // any other bill is swept after the loop.
            act("bs-want0", { type: "INIT_VAR", name: "$billsDue", arrayOf: [] }),
            { id: "bs-bills", type: "loop", overExpr: "$allInstances", as: "$bill", body: [
              { id: "bs-isdue", type: "if", condition: and(
                r("$bill._ancestors", "HAS_ANCESTOR", billsPageId),
                r("$bill.meta.feedSourceId", "IS_EMPTY", ""),
                r(DAY, "IS_NOT_EMPTY", ""),
                r(DAY, "IS", "$dayOfMonth"),
              ), then: [
                act("bs-want", { type: "PUSH_TO_VAR", name: "$billsDue", expr: "$bill.id" }),
                act("bs-ex0", { type: "INIT_VAR", name: "$existingPay", expr: "literal:" }),
                act("bs-ex", { type: "FIND", over: "$allInstances", itemIdVar: "$existingPay", predicate: and(
                  r("_ancestors", "HAS_ANCESTOR", "$todoId"),
                  r("templateId", "IS", payBillModuleId),
                  r(`fields.${billFieldId}.value`, "IS", "$bill.id"),
                ) }),
                { id: "bs-new", type: "if", condition: and(r("$existingPay", "IS_EMPTY", "")), then: [
                  act("bs-copy", {
                    type: "COPY_LINK", sourceId: `literal:${payBillSrcId}`, parent: "$todoId", linked: false,
                    fields: {
                      [billFieldId]: "$bill.id",
                      [dateFieldId]: "$day",
                      [amountFieldId]: `$bill.fields.${amountFieldId}.value`,
                      [accountFieldId]: `$bill.fields.${accountFieldId}.value`,
                      [completedFieldId]: false,
                    },
                    fieldHidden: { [dateFieldId]: true },
                  }),
                ] },
              ] },
            ] },
            { id: "bs-sweep", type: "loop", overExpr: "$allInstances", as: "$c", body: [
              { id: "bs-stale", type: "if", condition: and(
                r("$c._ancestors", "HAS_ANCESTOR", "$todoId"),
                r("$c.templateId", "IS", payBillModuleId),
                r("$c.meta.copyLinkSource", "IS", payBillSrcId),
                r(`$c.fields.${billFieldId}.value`, "IS_NOT_EMPTY", ""),
                r("$billsDue", "ARRAY_NOT_INCLUDES", `$c.fields.${billFieldId}.value`),
                r(`$c.fields.${completedFieldId}.value`, "IS_NOT", true),
              ), then: [act("bs-del", { type: "DELETE", itemIdExpr: "$c.id" })] },
            ] },
          ] },
        ] },
      ] },
    ],
  };
}

/** The Bills page's own events that should re-run it. */
export function billsTriggers({ billsPageId, dayFieldId, amountFieldId }) {
  return [
    { eventType: "onAdd", subjectType: "module", subjectRole: "instance", targetId: "", priority: 6, ancestorId: billsPageId },
    { eventType: "onDelete", subjectType: "module", subjectRole: "instance", targetId: "", priority: 6, ancestorId: billsPageId },
    { eventType: "onChange", subjectType: "field", targetId: dayFieldId, priority: 6 },
    { eventType: "onChange", subjectType: "field", targetId: amountFieldId, priority: 6 },
  ];
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation, Field, Grid, Occurrence, Module } = models;
  const grid = await Grid.findById(gridId).lean();
  const sf = grid?.meta?.scheduleFieldIds || {};
  const fields = await Field.find({ gridId }).lean();
  const one = (name, type) => { const h = fields.filter((f) => f.name === name && (!type || f.type === type)); return h.length === 1 ? h[0].id : null; };
  const ids = {
    schedPageId: sf.pageOccurrenceId, dateFieldId: sf.dateFieldId, formatFieldId: sf.scheduleFormatFieldId, timeslotFieldId: sf.timeslotFieldId,
    dayFieldId: one("Day", "number"), billFieldId: one("Bill", "occurrence"), amountFieldId: one("Amount", "number"),
    accountFieldId: one("Account", "occurrence"), completedFieldId: one("Completed", "boolean"),
  };
  // The Bills page: the one page module named "Bills", placed once.
  const billsPages = await Module.find({ gridId, role: "page", label: "Bills" }).lean();
  if (billsPages.length === 1) {
    const placed = await Occurrence.find({ gridId, moduleId: billsPages[0].id }).lean();
    if (placed.length === 1) ids.billsPageId = placed[0].id;
  }
  // The "Pay Bill" item: the one module that binds the Bill field; its source
  // placement is the one no operation copied.
  const payMods = (await Module.find({ gridId, role: "instance", "fieldBindings.fieldId": ids.billFieldId }).lean());
  if (payMods.length === 1) {
    ids.payBillModuleId = payMods[0].id;
    const srcs = (await Occurrence.find({ gridId, moduleId: payMods[0].id }).lean()).filter((o) => !o.meta?.copyLinkSource && !o.meta?.feedSourceId);
    if (srcs.length === 1) ids.payBillSrcId = srcs[0].id;
  }
  const need = ["schedPageId", "dateFieldId", "formatFieldId", "timeslotFieldId", "dayFieldId", "billFieldId", "amountFieldId", "accountFieldId", "completedFieldId", "billsPageId", "payBillModuleId", "payBillSrcId"];
  const missing = need.filter((k) => !ids[k]);
  if (missing.length) throw new Error(`0384: cannot resolve ${missing.join(", ")} — refusing`);

  const buildOp = await Operation.findOne({ gridId, name: "Schedule: Build Schedule" }).lean();
  const existing = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  log(`${existing ? "update" : "create"} "${OP_NAME}" · Bills page ${ids.billsPageId} · Pay Bill source ${ids.payBillSrcId} · Schedule page ${ids.schedPageId}`);
  if (dryRun) return;
  const doc = {
    name: OP_NAME,
    description: "Each Schedule day: a Pay Bill occurrence (bill selected, not completed) in the day's Todo for every bill whose Day is that day of the month.",
    pipeline: buildBillsPipeline(ids),
    enabled: true,
    triggerTypes: ["onLoad", "onFilterChange", "onAdd", "onDelete", "onChange"],
    triggerObjects: [
      ...(buildOp?.triggerObjects || [
        { eventType: "onLoad", subjectType: "grid", targetId: "", priority: 1 },
        { eventType: "onFilterChange", subjectType: "grid", targetId: "", priority: 1 },
      ]),
      ...billsTriggers(ids),
    ],
    targetOccurrenceId: ids.schedPageId,
    priority: 6,                    // after Build Schedule (default 5)
    folderId: buildOp?.folderId || null,
  };
  if (existing) await Operation.updateOne({ gridId, id: existing.id }, { $set: doc });
  else {
    const { nanoid } = await import("nanoid");
    await Operation.create({ ...doc, id: nanoid(12), gridId, userId: grid.userId });
  }
  log("done. Restart the server (pm2).");
}
