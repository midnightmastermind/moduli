// 0488 — each Schedule day's Occasions holds a copy-link of that day's appointments (user, 2026-11-08:
// "put in the occassion container in schedule, a copylink of the appointments for that day" ·
// "using an operation of course").
//
//  1. `Schedule: Place Dated Work` gets a pass inside its Occasions block (0453): every instance under
//     Tasks › Appointments dated that day is copy-linked into the day's Occasions, and a copy whose
//     appointment left Appointments is deleted. A copy whose appointment moved to another day is
//     already deleted by 0453's Occasions sweep (it checks the source's Date for every
//     `meta.occasion` copy). The copy is ALSO linked, so ticking it ticks the appointment.
//  2. An Occasions copy is a MIRROR of a row, like a feed copy: next to every
//     `<x>.meta.feedSourceId IS_EMPTY` rule in an AND group, every operation gets
//     `<x>.meta.occasion IS_EMPTY`, and so does any AND group that picks rows under the Schedule page
//     with no feed-copy rule (`Day Page: Build Tasks Completed`). Without this a ticked appointment is
//     counted twice — its time-slot copy (0447) and its Occasions copy both sit under the Schedule.
//     Holiday copies (0453) are mirrors too and are now skipped the same way.
//  3. Place Dated Work re-runs when an appointment is added to, moved into or out of Appointments.
import { withTodoTriggers } from "./0465-todo-tasks-place-on-add.mjs";

export const id = "0488-occasions-hold-the-days-appointments";
export const describe = "Each Schedule day's Occasions copy-links that day's appointments (Place Dated Work); every op skips Occasions copies like feed copies.";
export const touches = ["operations"];

const OP_NAME = "Schedule: Place Dated Work";
const MARK = "occasions-appts-0488";
const SCHEDULE_PAGE_REFS = new Set(["$schedPageId", "$scopePageId"]);

let n = 0;
const sid = () => `oa${Date.now().toString(36)}${(n++).toString(36)}`;
const act = (config) => ({ id: sid(), type: "action", config });
const rule = (left, comparator, right = "") => ({ id: sid(), left, comparator, right });
const iff = (rules, then, els = []) => ({ id: sid(), type: "if", condition: { operator: "AND", rules }, then, else: els });
const loop = (overExpr, as, body) => ({ id: sid(), type: "loop", overExpr, as, body });
const f = (fid) => `fields.${fid}.value`;

/** Steps that copy-link the day's appointments into its Occasions ($occasionsId, $day in scope). */
export function appointmentOccasionSteps({ appointmentsId, dateFieldId }) {
  return [
    loop("$allInstances", "$ap", [
      iff([
        rule("$ap._ancestors", "HAS_ANCESTOR", appointmentsId),
        rule(`$ap.${f(dateFieldId)}`, "SAME_DAY", "$day"),
        rule("$ap.meta.feedSourceId", "IS_EMPTY"),
        rule("$ap.meta.datedWork", "IS_EMPTY"),
      ], [
        act({ type: "INIT_VAR", name: "$apOccId", expr: "literal:", _mark: MARK }),
        act({ type: "FIND", over: "$allInstances", itemIdVar: "$apOccId", predicate: { operator: "AND", rules: [
          rule("meta.copyLinkSource", "IS", "$ap.id"),
          rule("parentId", "IS", "$occasionsId"),
        ] } }),
        iff([rule("$apOccId", "IS_EMPTY")], [
          act({ type: "COPY_LINK", sourceId: "$ap.id", parent: "$occasionsId", recursive: false,
                meta: { datedWork: true, occasion: true, occasionAppt: true }, itemIdVar: "$apOccId" }),
        ]),
      ]),
    ]),
    // Sweep: a copy whose appointment is still on this day but no longer under Appointments. (Moved to
    // another day, or gone: 0453's Occasions sweep already deletes those.)
    loop("$allInstances", "$oa", [
      iff([rule("$oa.parentId", "IS", "$occasionsId"), rule("$oa.meta.occasionAppt", "IS", true)], [
        act({ type: "SET_VAR", name: "$oaSrc", expr: "$allItemsById.${$oa.meta.copyLinkSource}" }),
        iff([
          rule(`$oaSrc.${f(dateFieldId)}`, "SAME_DAY", "$day"),
          rule("$oaSrc._ancestors", "NOT_HAS_ANCESTOR", appointmentsId),
        ], [act({ type: "DELETE", itemIdExpr: "$oa.id" })]),
      ]),
    ]),
  ];
}

const walk = (steps, fn) => { for (const s of steps || []) { fn(s); walk(s.then, fn); walk(s.else, fn); walk(s.body, fn); } };

/** The Date field the Occasions sweep (0453) compares with — read off the pipeline, never guessed. */
export function occasionDateFieldOf(pipeline) {
  const m = /"left":"\$ocSrc\.fields\.([^".]+)\.value","comparator":"SAME_DAY"/.exec(JSON.stringify(pipeline || {}));
  return m ? m[1] : null;
}

/** Pure: Place Dated Work with the appointments pass in its Occasions block (idempotent). */
export function patchPlaceDatedWork(pipeline, ids) {
  const p = structuredClone(pipeline);
  let done = false; walk(p.steps, (s) => { if (s.config?._mark === MARK) done = true; });
  if (done) return { pipeline: p, changed: false };
  let occIf = null;
  walk(p.steps, (s) => {
    const r = s.type === "if" && s.condition?.rules?.length === 1 ? s.condition.rules[0] : null;
    if (r && r.left === "$occasionsId" && r.comparator === "IS_NOT_EMPTY") occIf = occIf || s;
  });
  if (!occIf) throw new Error("Place Dated Work has no Occasions block (run 0453 first)");
  occIf.then.push(...appointmentOccasionSteps(ids));
  return { pipeline: p, changed: true };
}

/** The var prefix of a rule's left ("$appt." / "") when it ends in `suffix`, else null. */
const prefixOf = (left, suffix) => (typeof left === "string" && (left === suffix || left.endsWith(`.${suffix}`))
  ? left.slice(0, left.length - suffix.length) : null);

/** Pure: every AND group that skips feed copies — or picks ROWS (instances / items) under the Schedule
 *  page — also skips Occasions copies. A group over containers is left alone: an Occasions copy is
 *  never a container. Returns { pipeline, added, skippedOr }. OR groups are never touched: a sibling
 *  added there would widen the group, not narrow it. */
const ROW_POOLS = /\$all(Instances|Items|Occurrences)\b/;
export function addOccasionExclusion(pipeline, { schedulePageId } = {}) {
  const p = structuredClone(pipeline);
  let added = 0, skippedOr = 0;
  // `rowVar(prefix)` — does a rule prefix ("" for a FIND/loop predicate, "$x." in an IF) name a row?
  const visitGroup = (g, rowVar) => {
    if (!g || !Array.isArray(g.rules)) return;
    for (const r of g.rules) if (Array.isArray(r?.rules)) visitGroup(r, rowVar);
    const prefixes = new Set();
    for (const r of g.rules) {
      if (!r || Array.isArray(r.rules)) continue;
      const feed = r.comparator === "IS_EMPTY" ? prefixOf(r.left, "meta.feedSourceId") : null;
      const sched = r.comparator === "HAS_ANCESTOR"
        && (SCHEDULE_PAGE_REFS.has(r.right) || (schedulePageId && r.right === schedulePageId))
        ? prefixOf(r.left, "_ancestors") : null;
      if (feed !== null) prefixes.add(feed);
      if (sched !== null && rowVar(sched)) prefixes.add(sched);
    }
    if (!prefixes.size) return;
    if ((g.operator || "AND") !== "AND") { skippedOr += prefixes.size; return; }
    for (const pre of prefixes) {
      const left = `${pre}meta.occasion`;
      if (g.rules.some((r) => r?.left === left && r.comparator === "IS_EMPTY")) continue;
      g.rules.push(rule(left, "IS_EMPTY"));
      added++;
    }
  };
  // Loop variables carry where they came from, so an IF over `$cont.` knows `$cont` is a container.
  const visit = (steps, loopPools) => {
    for (const s of steps || []) {
      const isRow = (pre) => {
        if (pre === "") return false;
        const pool = loopPools[pre.replace(/\.$/, "")];
        return !!pool && ROW_POOLS.test(pool);
      };
      if (s.condition) visitGroup(s.condition, isRow);
      const over = s.type === "loop" ? (s.over || s.overExpr || "") : (s.config?.over || "");
      const ownRow = (pre) => pre === "" ? ROW_POOLS.test(over) : isRow(pre);
      if (s.predicate) visitGroup(s.predicate, ownRow);
      if (s.config?.predicate) visitGroup(s.config.predicate, ownRow);
      const inner = s.type === "loop" && s.as ? { ...loopPools, [s.as]: over } : loopPools;
      visit(s.then, inner); visit(s.else, inner); visit(s.body, inner);
    }
  };
  visit(p.steps, {});
  return { pipeline: p, added, skippedOr };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation, Occurrence, Module } = models;
  const ops = await Operation.find({ gridId }).lean();
  const pdw = ops.filter((o) => o.name === OP_NAME);
  if (pdw.length !== 1) { log(`  ${pdw.length} "${OP_NAME}" ops — nothing to do`); return; }

  // Tasks › Appointments: the Appointments container whose parent is the Tasks page.
  const apptMods = await Module.find({ gridId, label: "Appointments", role: "container" }, { id: 1 }).lean();
  const apptOccs = await Occurrence.find({ gridId, moduleId: { $in: apptMods.map((m) => m.id) } }, { id: 1, parentId: 1 }).lean();
  const parents = await Occurrence.find({ gridId, id: { $in: apptOccs.map((o) => o.parentId).filter(Boolean) } }, { id: 1, moduleId: 1 }).lean();
  const parentMods = await Module.find({ gridId, id: { $in: parents.map((p) => p.moduleId) } }, { id: 1, label: 1, role: 1 }).lean();
  const tasksPageOccs = new Set(parents.filter((p) => parentMods.some((m) => m.id === p.moduleId && m.label === "Tasks" && m.role === "page")).map((p) => p.id));
  const appts = apptOccs.filter((o) => tasksPageOccs.has(o.parentId));
  if (appts.length !== 1) throw new Error(`expected one Tasks › Appointments container, found ${appts.length}`);
  const appointmentsId = appts[0].id;

  const dateFieldId = occasionDateFieldOf(pdw[0].pipeline);
  if (!dateFieldId) throw new Error("could not read the Date field off the Occasions sweep");
  const schedM = /"\$schedPage","expr":"\$allItemsById\.([^"]+)"/.exec(JSON.stringify(pdw[0].pipeline));
  const schedulePageId = schedM ? schedM[1] : null;
  if (!schedulePageId) throw new Error("could not read the Schedule page off Place Dated Work");

  const now = new Date();
  for (const op of ops) {
    let pipeline = op.pipeline, changed = false;
    if (op.id === pdw[0].id) {
      const next = patchPlaceDatedWork(pipeline, { appointmentsId, dateFieldId });
      pipeline = next.pipeline; changed = next.changed;
    }
    const ex = addOccasionExclusion(pipeline, { schedulePageId });
    if (ex.skippedOr) log(`  ${op.name}: ${ex.skippedOr} mirror rule(s) sit in an OR group — left alone`);
    pipeline = ex.pipeline; changed = changed || ex.added > 0;
    const set = {};
    if (changed) set.pipeline = pipeline;
    if (op.id === pdw[0].id) {
      const triggers = withTodoTriggers(op.triggerObjects, appointmentsId);
      if (triggers.length !== (op.triggerObjects?.length || 0)) {
        set.triggerObjects = triggers;
        set.triggerTypes = [...new Set(triggers.map((t) => t.eventType))];
      }
    }
    if (!Object.keys(set).length) continue;
    log(`  ${op.name}: ${op.id === pdw[0].id ? "appointments pass + " : ""}${ex.added} occasion exclusion(s)${set.triggerObjects ? `, triggers ${op.triggerObjects?.length || 0} -> ${set.triggerObjects.length}` : ""}`);
    if (!dryRun) await Operation.updateOne({ gridId, id: op.id }, { $set: { ...set, updatedAt: now } });
  }
  log(`  Appointments ${appointmentsId} · Date ${dateFieldId} · Schedule ${schedulePageId}${dryRun ? " (dry run)" : ". RESTART pm2."}`);
}
