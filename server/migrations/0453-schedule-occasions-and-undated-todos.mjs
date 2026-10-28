// 0453 — an "Occasions" container above Todo in every Schedule day; undated
// Todo tasks reach every day's Todo as copy-links (user, 2026-10-28).
//
// The user: "make a birthdays container above the todo in schedule that the
// birthdays/holidays are placed in and not todos" (named Occasions) and, for
// the Tasks › Todo rows with no due date, "everyday as copylinked tasks".
//
//  1. The Schedule template (Schedule: Layout) gets an Occasions container as
//     its FIRST child, so Build Day copies it above Todo into every new day.
//     Every existing day column gets its copy too, placed right above its Todo
//     (the same shape Build Day makes: shared module, meta.copyLinkSource =
//     the template's Occasions).
//  2. `People: Birthdays` files into the day's Occasions instead of its Todo,
//     and the birthday cards already sitting in a day's Todo move there.
//  3. `Schedule: Place Dated Work` copy-links each Holiday (Schedule Type =
//     Holiday) dated that day into the day's Occasions, and sweeps a copy whose
//     holiday moved to another day.
//  4. The same op copy-links every unfinished Tasks › Todo row with no Due date
//     into each day's Todo, from the day it was created until the day it was
//     completed, and deletes a copy whose task no longer qualifies. A copy-link
//     shares every field (0445), so ticking either side ticks the task.
export const id = "0453-schedule-occasions-and-undated-todos";
export const describe = "Schedule days get an Occasions container (birthdays + holidays) above Todo; undated Tasks › Todo rows are copy-linked into every day's Todo until done.";
export const touches = ["occurrences", "modules", "operations"];

let n = 0;
const sid = () => `oc${Date.now().toString(36)}${(n++).toString(36)}`;
const act = (config) => ({ id: sid(), type: "action", config });
const rule = (left, comparator, right = "") => ({ id: sid(), left, comparator, right });
const group = (operator, rules) => ({ id: sid(), operator, rules });
const iff = (rules, then, els = []) => ({ id: sid(), type: "if", condition: { operator: "AND", rules }, then, else: els });
const loop = (overExpr, as, body) => ({ id: sid(), type: "loop", overExpr, as, body });
const f = (fid) => `fields.${fid}.value`;

const MARK = "occasions-0453";

/** Steps that copy-link the day's holidays into its Occasions ($dayColId, $day in scope). */
export function occasionSteps({ occasionsTplId, dateFieldId, timeslotFieldId, scheduleTypeFieldId, holidayTypeId }) {
  return [
    act({ type: "INIT_VAR", name: "$occasionsId", expr: "literal:", _mark: MARK }),
    act({ type: "FIND", over: "$allContainers", itemIdVar: "$occasionsId", predicate: { operator: "AND", rules: [
      rule("parentId", "IS", "$dayColId"),
      rule("meta.copyLinkSource", "IS", occasionsTplId),
    ] } }),
    iff([rule("$occasionsId", "IS_NOT_EMPTY")], [
      loop("$allInstances", "$hol", [
        iff([
          rule(`$hol.${f(scheduleTypeFieldId)}`, "IS", holidayTypeId),
          rule(`$hol.${f(dateFieldId)}`, "SAME_DAY", "$day"),
          rule(`$hol.${f(timeslotFieldId)}`, "IS_EMPTY"),
          rule("$hol.meta.feedSourceId", "IS_EMPTY"),
          rule("$hol.meta.datedWork", "IS_EMPTY"),
          rule("$hol.parentId", "IS_NOT", "$occasionsId"),
        ], [
          act({ type: "INIT_VAR", name: "$holCopyId", expr: "literal:" }),
          act({ type: "FIND", over: "$allInstances", itemIdVar: "$holCopyId", predicate: { operator: "AND", rules: [
            rule("meta.copyLinkSource", "IS", "$hol.id"),
            rule("parentId", "IS", "$occasionsId"),
          ] } }),
          iff([rule("$holCopyId", "IS_EMPTY")], [
            act({ type: "COPY_LINK", sourceId: "$hol.id", parent: "$occasionsId", recursive: false,
                  meta: { datedWork: true, occasion: true }, itemIdVar: "$holCopyId" }),
          ]),
        ]),
      ]),
      // Sweep: a holiday copy whose holiday is no longer on this day.
      loop("$allInstances", "$oc", [
        iff([rule("$oc.parentId", "IS", "$occasionsId"), rule("$oc.meta.occasion", "IS", true)], [
          act({ type: "SET_VAR", name: "$ocSrc", expr: "$allItemsById.${$oc.meta.copyLinkSource}" }),
          iff([rule("$ocSrc.id", "IS_NOT_EMPTY"), rule(`$ocSrc.${f(dateFieldId)}`, "SAME_DAY", "$day")], [], [
            act({ type: "DELETE", itemIdExpr: "$oc.id" }),
          ]),
        ]),
      ]),
    ]),
  ];
}

/** Whether `$<v>` (a task) belongs in the day's Todo: undated, in Tasks › Todo, not done before $day. */
function undatedRules(v, { todoContainerId, dueFieldId, completedFieldId, completedOnFieldId, timeslotFieldId }) {
  return [
    rule(`${v}.parentId`, "IS", todoContainerId),
    rule(`${v}.${f(dueFieldId)}`, "IS_EMPTY"),
    // A row with a time belongs in that time's slot, not the Todo.
    rule(`${v}.${f(timeslotFieldId)}`, "IS_EMPTY"),
    rule(`${v}.meta.feedSourceId`, "IS_EMPTY"),
    rule(`${v}Due`, "IS", true),
    // Ticked with no Completed On (older rows): done, never listed again.
    group("OR", [rule(`${v}.${f(completedFieldId)}`, "IS_NOT", true), rule(`${v}.${f(completedOnFieldId)}`, "IS_NOT_EMPTY")]),
  ];
}

/** Steps that copy-link undated Tasks › Todo rows into the day's Todo ($dueId, $day in scope). */
export function undatedTodoSteps(ids) {
  const { completedOnFieldId } = ids;
  const isDue = (v) => act({ type: "IS_DUE_ON", due: "2999-12-31", completedOn: `${v}.${f(completedOnFieldId)}`,
                             from: `${v}.createdAt`, day: "$day", to: `${v}Due` });
  return [
    loop("$allInstances", "$ut", [
      iff([rule("$ut.parentId", "IS", ids.todoContainerId)], [
        isDue("$ut"),
        iff(undatedRules("$ut", ids), [
          act({ type: "INIT_VAR", name: "$utCopyId", expr: "literal:" }),
          act({ type: "FIND", over: "$allInstances", itemIdVar: "$utCopyId", predicate: { operator: "AND", rules: [
            rule("meta.copyLinkSource", "IS", "$ut.id"),
            rule("parentId", "IS", "$dueId"),
          ] } }),
          iff([rule("$utCopyId", "IS_EMPTY")], [
            act({ type: "COPY_LINK", sourceId: "$ut.id", parent: "$dueId", recursive: false,
                  meta: { todoCopy: true }, itemIdVar: "$utCopyId" }),
          ]),
        ]),
      ]),
    ]),
    // Sweep: a copy whose task is gone, dated, moved out of Todo, or done before this day.
    loop("$allInstances", "$tc", [
      iff([rule("$tc.parentId", "IS", "$dueId"), rule("$tc.meta.todoCopy", "IS", true)], [
        act({ type: "SET_VAR", name: "$tcSrc", expr: "$allItemsById.${$tc.meta.copyLinkSource}" }),
        isDue("$tcSrc"),
        iff(undatedRules("$tcSrc", ids), [], [act({ type: "DELETE", itemIdExpr: "$tc.id" })]),
      ]),
    ]),
  ];
}

const walk = (steps, fn) => { for (const s of steps || []) { fn(s); walk(s.then, fn); walk(s.else, fn); walk(s.body, fn); } };
const isIfOn = (s, left) => s.type === "if" && s.condition?.rules?.length === 1
  && s.condition.rules[0].left === left && s.condition.rules[0].comparator === "IS_NOT_EMPTY";

/** Pure: the Place Dated Work pipeline with both passes added (idempotent). */
export function patchPlaceDatedWork(pipeline, ids) {
  const p = structuredClone(pipeline);
  let done = false; walk(p.steps, (s) => { if (s.config?._mark === MARK) done = true; });
  if (done) return { pipeline: p, changed: false };
  let dayIf = null, dueIf = null;
  walk(p.steps, (s) => { if (isIfOn(s, "$dayColId")) dayIf = dayIf || s; if (isIfOn(s, "$dueId")) dueIf = dueIf || s; });
  if (!dayIf || !dueIf) throw new Error(`Place Dated Work: day-column if ${!!dayIf}, Todo if ${!!dueIf}`);
  dueIf.then.push(...undatedTodoSteps(ids));
  dayIf.then.push(...occasionSteps(ids));
  return { pipeline: p, changed: true };
}

/** Pure: People: Birthdays finds the day's Occasions instead of its Todo. */
export function patchBirthdays(pipeline, { occasionsTplId }) {
  const p = structuredClone(pipeline);
  let hits = 0;
  walk(p.steps, (s) => {
    if (s.config?.type === "FIND" && s.config.itemIdVar === "$todoId") {
      s.config.predicate = { operator: "AND", rules: [rule("parentId", "IS", "$dayColId"), rule("meta.copyLinkSource", "IS", occasionsTplId)] };
      hits++;
    }
  });
  if (hits !== 1) throw new Error(`People: Birthdays: expected one $todoId FIND, found ${hits}`);
  return p;
}

/** Pure: where each existing day column's Occasions goes, and which birthday cards move into it. */
export function planDays(occurrences, { schedulePageId, scheduleFormatFieldId, timeslotFieldId, occasionsTplId, birthdayModuleId }) {
  const byId = new Map(occurrences.map((o) => [o.id, o]));
  const plan = [];
  for (const col of occurrences) {
    if (col.parentId !== schedulePageId || col.fields?.[scheduleFormatFieldId]?.value !== "day-col") continue;
    const kids = (col.occurrences || []).map((id) => byId.get(id)).filter(Boolean);
    if (kids.some((k) => k.meta?.copyLinkSource === occasionsTplId)) continue;
    const todo = kids.find((k) => k.fields?.[timeslotFieldId]?.value === "Todo");
    const cards = todo ? (todo.occurrences || []).filter((id) => byId.get(id)?.moduleId === birthdayModuleId) : [];
    plan.push({ colId: col.id, index: todo ? col.occurrences.indexOf(todo.id) : 0, todoId: todo?.id || null, cards });
  }
  return plan;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const fid = async (name) => {
    const fs = await Field.find({ gridId, name }).lean();
    if (fs.length !== 1) throw new Error(`expected one field "${name}", found ${fs.length}`);
    return fs[0].id;
  };
  const ids = {
    dateFieldId: await fid("Date"), timeslotFieldId: await fid("Time Slot"), scheduleFormatFieldId: await fid("Schedule Format"),
    scheduleTypeFieldId: await fid("Schedule Type"), dueFieldId: await fid("Due"), completedFieldId: await fid("Completed"),
    completedOnFieldId: await fid("Completed On"),
  };
  const one = async (q, what) => { const r = await q; if (r.length !== 1) throw new Error(`expected one ${what}, found ${r.length}`); return r[0]; };

  // The template is whatever Build Day copies slots from: its `$dayCont` INIT_VAR.
  const buildDay = await one(Operation.find({ gridId, name: "Schedule: Build Day" }).lean(), "Schedule: Build Day op");
  let tplId = null;
  walk(buildDay.pipeline.steps, (s) => { if (s.config?.type === "INIT_VAR" && s.config.name === "$dayCont") tplId = String(s.config.expr).replace("$allItemsById.", ""); });
  const tpl = await Occurrence.findOne({ gridId, id: tplId }).lean();
  if (!tpl) throw new Error(`Build Day's template ${tplId} not found`);
  const schedPage = await one(Occurrence.find({ gridId, id: { $in: (await Occurrence.find({ gridId, "fields.vQ0ELZP_zxnx.value": "day-col" }, { parentId: 1 }).lean()).map((c) => c.parentId) } }).lean(), "Schedule page");
  const tasksTodoMods = await Module.find({ gridId, label: "Todo", role: "container" }, { id: 1 }).lean();
  const tasksPageMods = await Module.find({ gridId, label: "Tasks", role: "page" }, { id: 1 }).lean();
  const tasksPages = new Set((await Occurrence.find({ gridId, moduleId: { $in: tasksPageMods.map((m) => m.id) } }, { id: 1 }).lean()).map((o) => o.id));
  const todoContainer = await one(Occurrence.find({ gridId, moduleId: { $in: tasksTodoMods.map((m) => m.id) } }).lean().then((r) => r.filter((o) => tasksPages.has(o.parentId))), "Todo container on Tasks");
  const holidayMod = await Module.find({ gridId, label: "Holiday", role: "instance" }, { id: 1 }).lean();
  const holiday = await one(Occurrence.find({ gridId, moduleId: { $in: holidayMod.map((m) => m.id) }, "meta.feedSourceId": { $exists: false } }).lean().then((r) => r.filter((o) => !o.meta?.feedSourceId)), "Holiday schedule type");
  const bdayMod = await one(Module.find({ gridId, label: "Birthday", role: "instance" }).lean(), "Birthday module");
  const todoTplId = (tpl.occurrences || []).find(Boolean);
  const todoTpl = await Occurrence.findOne({ gridId, id: todoTplId }).lean();
  if (todoTpl?.fields?.[ids.timeslotFieldId]?.value !== "Todo") throw new Error("the template's first child is not its Todo");
  const todoTplMod = await Module.findOne({ gridId, id: todoTpl.moduleId }).lean();

  // Re-run: the template already has its Occasions.
  const tplKids = await Occurrence.find({ gridId, id: { $in: tpl.occurrences } }, { id: 1, moduleId: 1 }).lean();
  const existingMods = await Module.find({ gridId, id: { $in: tplKids.map((k) => k.moduleId) }, label: "Occasions" }, { id: 1 }).lean();
  const existingTpl = tplKids.find((k) => existingMods.some((m) => m.id === k.moduleId));
  const occasionsTplId = existingTpl?.id || `occasions-tpl-${Date.now().toString(36)}`;
  const occasionsModId = existingTpl?.moduleId || `occasions-mod-${Date.now().toString(36)}`;
  Object.assign(ids, { occasionsTplId, todoContainerId: todoContainer.id, holidayTypeId: holiday.id });

  const occs = await Occurrence.find({ gridId }, { id: 1, moduleId: 1, parentId: 1, occurrences: 1, fields: 1, meta: 1 }).lean();
  const days = planDays(occs, { schedulePageId: schedPage.id, ...ids, birthdayModuleId: bdayMod.id });
  const pdw = await one(Operation.find({ gridId, name: "Schedule: Place Dated Work" }).lean(), "Place Dated Work op");
  const bday = await one(Operation.find({ gridId, name: "People: Birthdays" }).lean(), "People: Birthdays op");
  const pdwNext = patchPlaceDatedWork(pdw.pipeline, ids);
  const bdayNext = patchBirthdays(bday.pipeline, ids);

  log(`  template ${tpl.id}: Occasions ${existingTpl ? "already there" : "to add"} (${occasionsTplId})`);
  log(`  Tasks › Todo ${todoContainer.id} · Holiday ${holiday.id} · Birthday module ${bdayMod.id}`);
  log(`  ${days.length} day column(s) get an Occasions; ${days.reduce((a, d) => a + d.cards.length, 0)} birthday card(s) move out of Todo`);
  log(`  Place Dated Work: ${pdwNext.changed ? "patched" : "already patched"} · People: Birthdays retargeted`);
  if (dryRun) return;

  const now = new Date();
  const base = { userId: tpl.userId, gridId };
  if (!existingTpl) {
    await Module.create({ ...base, id: occasionsModId, label: "Occasions", role: "container", kind: "board",
      meta: { ...(todoTplMod?.meta || {}) }, fieldBindings: [], createdAt: now, updatedAt: now });
    await Occurrence.create({ ...base, id: occasionsTplId, moduleId: occasionsModId, parentId: tpl.id, occurrences: [], fields: {}, meta: {}, createdAt: now, updatedAt: now });
    await Occurrence.updateOne({ gridId, id: tpl.id }, { $push: { occurrences: { $each: [occasionsTplId], $position: 0 } }, $set: { updatedAt: now } });
  }
  for (const d of days) {
    const id = `occ-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await Occurrence.create({ ...base, id, moduleId: occasionsModId, parentId: d.colId, occurrences: d.cards, fields: {},
      meta: { createdByOperation: true, copyLinkSource: occasionsTplId }, createdAt: now, updatedAt: now });
    await Occurrence.updateOne({ gridId, id: d.colId }, { $push: { occurrences: { $each: [id], $position: d.index } }, $set: { updatedAt: now } });
    if (d.cards.length) {
      await Occurrence.updateOne({ gridId, id: d.todoId }, { $pull: { occurrences: { $in: d.cards } }, $set: { updatedAt: now } });
      await Occurrence.updateMany({ gridId, id: { $in: d.cards } }, { $set: { parentId: id, updatedAt: now } });
    }
  }
  if (pdwNext.changed) await Operation.updateOne({ gridId, id: pdw.id }, { $set: { pipeline: pdwNext.pipeline, updatedAt: now } });
  await Operation.updateOne({ gridId, id: bday.id }, { $set: { pipeline: bdayNext, updatedAt: now } });

  const after = await Occurrence.find({ gridId }, { id: 1, moduleId: 1, parentId: 1, occurrences: 1, fields: 1, meta: 1 }).lean();
  const left = planDays(after, { schedulePageId: schedPage.id, ...ids, birthdayModuleId: bdayMod.id });
  if (left.length) throw new Error(`${left.length} day column(s) still without an Occasions`);
  log("  applied. RESTART pm2.");
}
