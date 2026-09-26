// server/migrations/0367-birthdays-into-schedule-todo.mjs
//
// "People: Birthdays" — every day the Schedule builds, anyone on the People
// board whose Birthday falls on that day gets a card in THAT day's Todo
// (user, 2026-09-26: "check the people page everyday and put a birthday
// occurance … in the todo section for that day … Birthday - Name - how old").
// A day's Todo is shared by its Schedule column and its Day Page column, so the
// card shows in both.
//
//   label   "Birthday - <full name> - turns <age>" (the Name field; the card
//           label when Name is empty); just "Birthday - <name>" when the
//           year is not known (stored as 1900 — migration 0365)
//   module  ONE shared "Birthday" item (CREATE reuses a module by name); each
//           card's own label is set on the placement
//   fields  People = the person (a link back to their card), Date = the day
//           (hidden — the day's column already says the date)
//
// Same triggers and day list as "Schedule: Build Schedule" (grid load and
// filter change, over `$activePeriodDates` of the Schedule page), and a later
// priority so the day's column and Todo already exist when it runs. Idempotent:
// a card with the same label already in that Todo is left alone, and a
// birthday card no longer wanted (person deleted, birthday or name changed) is
// removed. It also re-runs when a person is added or deleted or their Birthday
// or Name is edited.

export const id = "0367-birthdays-into-schedule-todo";
export const describe = "Creates the 'People: Birthdays' operation: each Schedule day, people whose Birthday is that day get a 'Birthday - Name - turns N' card in the day's Todo.";
export const touches = ["operations"];

export const OP_NAME = "People: Birthdays";

const r = (left, comparator, right) => ({ left, comparator, right });
const and = (...rules) => ({ operator: "AND", rules });
const act = (id, config) => ({ id, type: "action", config });

/** PURE. The pipeline, given the ids it needs. */
export function buildBirthdayPipeline({ schedPageId, peopleContId, birthdayFieldId, peopleFieldId, dateFieldId, formatFieldId, timeslotFieldId, nameFieldId }) {
  const B = `$p.fields.${birthdayFieldId}.value`;
  const create = act("bd-create", {
    type: "CREATE", name: "Birthday", role: "instance", parent: "$todoId",
    fields: { [peopleFieldId]: "$p.id", [dateFieldId]: "$day" },
    fieldHidden: { [dateFieldId]: true },
    itemVar: "$newBday",
  });
  return {
    sources: [],
    steps: [
      act("bd-page", { type: "INIT_VAR", name: "$schedPageId", expr: `literal:${schedPageId}` }),
      { id: "bd-days", type: "loop", overExpr: "$activePeriodDates", as: "$day", body: [
        act("bd-col0", { type: "INIT_VAR", name: "$dayColId", expr: "literal:" }),
        act("bd-col", { type: "FIND", over: "$allContainers", itemIdVar: "$dayColId", predicate: and(
          r("_ancestors", "HAS_ANCESTOR", "$schedPageId"),
          r(`fields.${formatFieldId}.value`, "IS", "day-col"),
          r(`fields.${dateFieldId}.value`, "SAME_DAY", "$day"),
        ) }),
        { id: "bd-hascol", type: "if", condition: and(r("$dayColId", "IS_NOT_EMPTY", "")), then: [
          act("bd-todo0", { type: "INIT_VAR", name: "$todoId", expr: "literal:" }),
          act("bd-todo", { type: "FIND", over: "$allContainers", itemIdVar: "$todoId", predicate: and(
            r("_ancestors", "HAS_ANCESTOR", "$dayColId"),
            r(`fields.${timeslotFieldId}.value`, "IS", "Todo"),
          ) }),
          { id: "bd-hastodo", type: "if", condition: and(r("$todoId", "IS_NOT_EMPTY", "")), then: [
            act("bd-daymd", { type: "DATE_FORMAT", date: "$day", format: "MM-dd", to: "$dayMD" }),
            act("bd-dayy", { type: "DATE_FORMAT", date: "$day", format: "yyyy", to: "$dayY" }),
            // Every card this day SHOULD have. Anything else labelled as a
            // birthday in this Todo — a person deleted, a birthday or name
            // edited — is swept after the loop.
            act("bd-want0", { type: "INIT_VAR", name: "$wantedBdays", arrayOf: [] }),
            { id: "bd-people", type: "loop", overExpr: "$allInstances", as: "$p", body: [
              { id: "bd-isperson", type: "if", condition: and(
                r("$p._ancestors", "HAS_ANCESTOR", peopleContId),
                r(B, "IS_NOT_EMPTY", ""),
              ), then: [
                act("bd-bmd", { type: "DATE_FORMAT", date: B, format: "MM-dd", to: "$bMD" }),
                { id: "bd-today", type: "if", condition: and(r("$bMD", "IS", "$dayMD")), then: [
                  act("bd-by", { type: "DATE_FORMAT", date: B, format: "yyyy", to: "$bY" }),
                  // The person's FULL name (the Name field); the card label is
                  // often an Instagram handle. Falls back to the label.
                  act("bd-who", { type: "INIT_VAR", name: "$who", expr: `$p.fields.${nameFieldId}.value`, fallback: "$p.label" }),
                  { id: "bd-noname", type: "if", condition: and(r("$who", "IS_EMPTY", "")),
                    then: [act("bd-who2", { type: "INIT_VAR", name: "$who", expr: "$p.label" })] },
                  { id: "bd-noyear", type: "if", condition: and(r("$bY", "IS", "1900")),
                    then: [act("bd-l1", { type: "INIT_VAR", name: "$bdayLabel", expr: "Birthday - ${$who}" })],
                    else: [
                      act("bd-age", { type: "INIT_VAR", name: "$age", expr: "$dayY" }),
                      act("bd-sub", { type: "SUBTRACT_FROM_VAR", name: "$age", expr: "$bY" }),
                      act("bd-l2", { type: "INIT_VAR", name: "$bdayLabel", expr: "Birthday - ${$who} - turns ${$age}" }),
                    ] },
                  act("bd-want", { type: "PUSH_TO_VAR", name: "$wantedBdays", expr: "$bdayLabel" }),
                  act("bd-ex0", { type: "INIT_VAR", name: "$existingBday", expr: "literal:" }),
                  act("bd-ex", { type: "FIND", over: "$allInstances", itemIdVar: "$existingBday", predicate: and(
                    r("_ancestors", "HAS_ANCESTOR", "$todoId"),
                    r("label", "IS", "$bdayLabel"),
                  ) }),
                  { id: "bd-new", type: "if", condition: and(r("$existingBday", "IS_EMPTY", "")), then: [
                    create,
                    act("bd-label", { type: "UPDATE", path: "$newBday.label", value: "$bdayLabel" }),
                  ] },
                ] },
              ] },
            ] },
            { id: "bd-sweep", type: "loop", overExpr: "$allInstances", as: "$c", body: [
              { id: "bd-stale", type: "if", condition: and(
                r("$c._ancestors", "HAS_ANCESTOR", "$todoId"),
                r("$c.moduleLabel", "IS", "Birthday"),
                r("$wantedBdays", "ARRAY_NOT_INCLUDES", "$c.label"),
              ), then: [act("bd-del", { type: "DELETE", itemIdExpr: "$c.id" })] },
            ] },
          ] },
        ] },
      ] },
    ],
  };
}

/** The People board's own events that should re-run it: a person added or
 *  deleted, or their Birthday / Name edited. */
export function peopleTriggers({ peopleContId, birthdayFieldId, nameFieldId }) {
  return [
    { eventType: "onAdd", subjectType: "module", subjectRole: "instance", targetId: "", priority: 6, ancestorId: peopleContId },
    { eventType: "onDelete", subjectType: "module", subjectRole: "instance", targetId: "", priority: 6, ancestorId: peopleContId },
    { eventType: "onChange", subjectType: "field", targetId: birthdayFieldId, priority: 6 },
    { eventType: "onChange", subjectType: "field", targetId: nameFieldId, priority: 6 },
  ];
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation, Field, Grid, Occurrence } = models;
  const grid = await Grid.findById(gridId).lean();
  const sf = grid?.meta?.scheduleFieldIds || {};
  const fields = await Field.find({ gridId }).lean();
  const one = (name, type) => { const h = fields.filter((f) => f.name === name && (!type || f.type === type)); return h.length === 1 ? h[0].id : null; };
  const ids = {
    schedPageId: sf.pageOccurrenceId, dateFieldId: sf.dateFieldId, formatFieldId: sf.scheduleFormatFieldId,
    timeslotFieldId: sf.timeslotFieldId, birthdayFieldId: one("Birthday", "date"), peopleFieldId: one("People", "occurrence"),
    nameFieldId: one("Name"),
  };
  // The People board: the container that holds the people (0352's social-import cards).
  const person = await Occurrence.findOne({ gridId, "meta.source": "social-import" }).lean();
  ids.peopleContId = person?.parentId || null;
  const missing = Object.entries(ids).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) { log(`missing: ${missing.join(", ")} — refusing`); return; }

  const buildOp = await Operation.findOne({ gridId, name: "Schedule: Build Schedule" }).lean();
  const existing = await Operation.findOne({ gridId, name: OP_NAME }).lean();
  const pipeline = buildBirthdayPipeline(ids);
  log(`${existing ? "update" : "create"} "${OP_NAME}" · people board ${ids.peopleContId} · Schedule page ${ids.schedPageId}`);
  if (dryRun) return;
  const doc = {
    name: OP_NAME,
    description: "Each Schedule day: a 'Birthday - Name - turns N' card in the day's Todo for everyone on the People board born that day.",
    pipeline,
    enabled: true,
    triggerTypes: ["onLoad", "onFilterChange", "onAdd", "onDelete", "onChange"],
    triggerObjects: [
      ...(buildOp?.triggerObjects || [
        { eventType: "onLoad", subjectType: "grid", targetId: "", priority: 1 },
        { eventType: "onFilterChange", subjectType: "grid", targetId: "", priority: 1 },
      ]),
      // User, 2026-09-26: "have it run on update of peoples board to, so the
      // schedule updates if i delete or add a person".
      ...peopleTriggers(ids),
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
