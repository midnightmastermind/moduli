/**
 * 0161 — seven weekday templates replace the five-day cycle.
 *
 * USER, 2026-08-20: ***"i dont want a cycle, i just want 7 day templates"***, then ***"give the
 * templates weekday fields"***, and — asked how five workout days map onto seven weekdays —
 * **Mon Push / Tue Legs / Wed Pull / Thu Core & Cardio / Fri Cardio / Sat + Sun Rest**.
 *
 * IT RENAMES THE FIVE RATHER THAN MINTING SEVEN, because four of them are already exactly the day
 * the user asked for. Day 1 IS Monday's push session, Day 2 IS Tuesday's legs, and so on — minting
 * seven fresh templates would mean re-creating ~340 slot occurrences to arrive at content this grid
 * already holds, and would strand the five as dead clutter of the kind the user has complained about
 * once already ("why are the old ingredients in the grocery list").
 *
 *     Day 1  Push           -> Monday      (as-is)
 *     Day 2  Legs           -> Tuesday     (as-is)
 *     Day 3  Pull           -> Wednesday   (as-is)
 *     Day 4  Core & Cardio  -> Thursday    (as-is, keeps its Run + Stretch)
 *     Day 5  Rest           -> Friday      + Run and Stretch, per the user's "Fri: cardio only"
 *            clone of Friday-before-cardio -> Saturday, Sunday
 *
 * THE WEEKDAY IS A FIELD ON THE TEMPLATE, not its name — the user asked for it in those words and it
 * is the right shape anyway. The placement op matches the column's weekday against this VALUE, so a
 * template can be renamed to anything without breaking, and nothing anywhere parses a label. That is
 * the trap the 2026-07-26 de-schedule sweep removed `SCHEDULE_LABEL_PREFIX` for.
 *
 * THE DAILY ROUTINES ARE STRIPPED OUT OF ALL SEVEN, and this is the load-bearing decision.
 * `Schedule: Build Schedule` already copies Drink, Hygiene, Hot Tub, Take Medication, Walk and
 * Journal onto every column from the `Day` template. The cycle templates carried them too, harmlessly,
 * because `Place Cycle Day` only ever placed rows holding a Meal or Movement PICK. **The weekday op
 * cannot keep that filter** — the whole point is that a user can drop an APPOINTMENT on Tuesday, and
 * an appointment carries neither pick. So the op places everything on the template, and the template
 * must therefore hold only what makes that weekday DIFFERENT. `Day` = every day; a weekday template
 * = only this weekday.
 *
 * Which rows are "daily" is decided STRUCTURALLY — a row whose slot time AND module label both match
 * a row on `Day` — never from a list of names. Day 4's Run and Stretch sit at 7:00am, which `Day` has
 * nothing in, so they survive; that is the discriminating case, and the reason the rule tests the
 * slot as well as the label.
 *
 * Nothing here touches an operation or a day column. `0162` does that, after this is read back.
 */
import { cloneSubtree } from "../utils/cloneSubtree.js";

export const id = "0161-seven-weekday-templates";
export const describe = "Rename the five cycle templates to Mon-Fri, clone Sat/Sun, give all seven a Weekday field, and strip the daily routines out of them.";

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const FROM_CYCLE = {
  "Schedule - Day 1": "Monday", "Schedule - Day 2": "Tuesday", "Schedule - Day 3": "Wednesday",
  "Schedule - Day 4": "Thursday", "Schedule - Day 5": "Friday",
};
const CLONE_FROM = "Friday";        // a rest day: meals only, once the routines are stripped
const CLONE_TO = ["Saturday", "Sunday"];
const CARDIO_ONTO = "Friday";       // user: "Fri - Run + Stretch only"
const CARDIO_FROM = "Thursday";     // the only template that already holds them
const CARDIO = ["Run", "Stretch"];

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Field.find({ gridId }).lean(),
  ]);
  const mById = new Map(mods.map(m => [m.id, m]));
  const oById = new Map(occs.map(o => [o.id, o]));
  const lbl = (o) => o?.label || mById.get(o?.moduleId)?.label || "";
  const TS = fields.find(f => f.name === "Time Slot" && !f.displayEnabled)?.id;
  if (!TS) { log("  REFUSING: no \"Time Slot\" field"); return; }

  const stPage = occs.find(o => lbl(o) === "Schedule Template");
  const templatesOf = () => (stPage?.occurrences || []).map(i => oById.get(i)).filter(Boolean);
  const base = templatesOf().find(t => lbl(t) === "Day");
  if (!stPage || !base) { log("  REFUSING: no \"Schedule Template\" page or no \"Day\" template"); return; }

  // ---- what the DAY template puts on every column, as (time, label) pairs ---
  const dailyPairs = new Set();
  for (const sid of base.occurrences || []) {
    const s = oById.get(sid); const t = s?.fields?.[TS]?.value;
    for (const k of (s?.occurrences || []).map(i => oById.get(i)).filter(Boolean)) dailyPairs.add(`${t} ${lbl(k)}`);
  }
  log(`  "Day" places ${dailyPairs.size} row(s) on every column: ${[...dailyPairs].join(", ")}`);

  const present = Object.fromEntries(templatesOf().map(t => [lbl(t), t]));
  const wd = fields.find(f => f.name === "Weekday");
  const toRename = Object.entries(FROM_CYCLE).filter(([from]) => present[from]);
  const already = WEEKDAYS.filter(d => present[`Schedule - ${d}`]);
  log(`  Weekday field: ${wd ? "present" : "to create"}`);
  log(`  cycle templates to rename: ${toRename.length}${already.length ? ` | already weekday-named: ${already.join(", ")}` : ""}`);

  // ---- rows to strip, counted before anything is written ------------------
  const stripTargets = [];
  for (const t of templatesOf()) {
    const name = lbl(t);
    const isWeekday = FROM_CYCLE[name] || WEEKDAYS.some(d => name === `Schedule - ${d}`);
    if (!isWeekday) continue;
    for (const sid of t.occurrences || []) {
      const s = oById.get(sid); const time = s?.fields?.[TS]?.value;
      for (const k of (s?.occurrences || []).map(i => oById.get(i)).filter(Boolean)) {
        if (dailyPairs.has(`${time} ${lbl(k)}`)) stripTargets.push({ tpl: name, slot: s, row: k, time });
      }
    }
  }
  log(`  daily-routine rows to strip from the weekday templates: ${stripTargets.length}`);
  const toClone = CLONE_TO.filter(d => !present[`Schedule - ${d}`]);
  log(`  templates to clone: ${toClone.length ? toClone.join(", ") : "none"}`);
  if (dryRun) { log("  (dry run - nothing written)"); return; }

  const uid = () => Math.random().toString(36).slice(2, 14);

  // ---- 1. the Weekday field, shaped like Time Slot ------------------------
  let wdId = wd?.id;
  if (!wd) {
    wdId = uid();
    await Field.create({
      id: wdId, gridId, userId: stPage.userId, name: "Weekday", type: "select",
      inputEnabled: true, displayEnabled: false,
      meta: { optionsSource: { mode: "manual", values: WEEKDAYS.map(d => ({ value: d, label: d })) } },
    });
    log("  created the \"Weekday\" field");
  }

  // ---- 2. rename + stamp ---------------------------------------------------
  const stamp = async (tpl, day) => {
    const mod = mById.get(tpl.moduleId);
    if (mod && mod.label !== `Schedule - ${day}`) {
      await Module.updateOne({ id: mod.id, gridId }, { $set: { label: `Schedule - ${day}` } });
      mod.label = `Schedule - ${day}`;
    }
    if (mod && !(mod.fieldBindings || []).some(b => b.fieldId === wdId)) {
      await Module.updateOne({ id: mod.id, gridId }, { $push: { fieldBindings: {
        fieldId: wdId, order: (mod.fieldBindings || []).length, role: "input" } } });
    }
    if (tpl.fields?.[wdId]?.value !== day) {
      await Occurrence.updateOne({ id: tpl.id, gridId }, { $set: { [`fields.${wdId}`]: { value: day, flow: "in" } } });
    }
    log(`  ${`Schedule - ${day}`.padEnd(22)} Weekday = ${day}`);
  };
  for (const [from, day] of toRename) await stamp(present[from], day);
  for (const day of already) await stamp(present[`Schedule - ${day}`], day);

  // ---- 3. strip the daily routines ----------------------------------------
  for (const { tpl, slot, row, time } of stripTargets) {
    await Occurrence.updateOne({ id: slot.id, gridId }, { $pull: { occurrences: row.id } });
    await Occurrence.deleteOne({ id: row.id, gridId });
    // The module goes with it only when nothing else places it. A template row
    // has its own clone module, but proving that beats assuming it.
    const others = occs.filter(o => o.moduleId === row.moduleId && o.id !== row.id).length;
    if (!others) await Module.deleteOne({ id: row.moduleId, gridId });
    log(`  stripped ${lbl(row)} at ${time} from ${tpl}`);
  }

  // ---- 4. clone Saturday and Sunday ---------------------------------------
  if (toClone.length) {
    const fresh = await Occurrence.find({ gridId }).lean();
    const freshMods = await Module.find({ gridId }).lean();
    const uc = {
      occurrencesById: Object.fromEntries(fresh.map(o => [o.id, o])),
      modulesById: Object.fromEntries(freshMods.map(m => [m.id, m])),
    };
    const persist = {
      saveModule: (m) => Module.findOneAndUpdate({ id: m.id }, m, { upsert: true }),
      saveOccurrence: (o) => Occurrence.findOneAndUpdate({ id: o.id }, o, { upsert: true }),
    };
    const source = Object.values(uc.occurrencesById).find(o =>
      (uc.modulesById[o.moduleId]?.label) === `Schedule - ${CLONE_FROM}`);
    if (!source) { log(`  REFUSING to clone: no "Schedule - ${CLONE_FROM}" to copy`); return; }
    for (const day of toClone) {
      const { rootClonedOccurrenceId } = await cloneSubtree({
        rootOccurrenceId: source.id, userId: source.userId, gridId, uc,
        newParentId: stPage.id, rootLabel: `Schedule - ${day}`, persist,
      });
      await Occurrence.updateOne({ id: rootClonedOccurrenceId, gridId },
        { $set: { [`fields.${wdId}`]: { value: day, flow: "in" } } });
      await Occurrence.updateOne({ id: stPage.id, gridId }, { $addToSet: { occurrences: rootClonedOccurrenceId } });
      // cloneSubtree names the ROOT through `rootLabel`, which is an OCCURRENCE
      // label; the clone's module keeps the source's name. Every read path
      // prefers the occurrence label, so this works either way - but the two
      // disagreeing is exactly how the "(unnamed) template" bugs start.
      const clone = await Occurrence.findOne({ id: rootClonedOccurrenceId, gridId }).lean();
      await Module.updateOne({ id: clone.moduleId, gridId }, { $set: { label: `Schedule - ${day}` } });
      log(`  cloned "${CLONE_FROM}" -> "Schedule - ${day}"`);
    }
  }

  // ---- 5. Friday's cardio --------------------------------------------------
  const after = await Occurrence.find({ gridId }).lean();
  const afterMods = await Module.find({ gridId }).lean();
  const aById = new Map(after.map(o => [o.id, o]));
  const amById = new Map(afterMods.map(m => [m.id, m]));
  const alab = (o) => o?.label || amById.get(o?.moduleId)?.label || "";
  const tplNamed = (day) => after.find(o => alab(o) === `Schedule - ${day}`);
  const src = tplNamed(CARDIO_FROM), dst = tplNamed(CARDIO_ONTO);
  if (src && dst) {
    for (const name of CARDIO) {
      let from = null, fromTime = null;
      for (const sid of src.occurrences || []) {
        const s = aById.get(sid);
        const hit = (s?.occurrences || []).map(i => aById.get(i)).find(k => alab(k) === name);
        if (hit) { from = hit; fromTime = s.fields?.[TS]?.value; }
      }
      if (!from) { log(`  ${name} is not on ${CARDIO_FROM} - skipped`); continue; }
      const slot = (dst.occurrences || []).map(i => aById.get(i)).find(s => s?.fields?.[TS]?.value === fromTime);
      if (!slot) { log(`  ${CARDIO_ONTO} has no ${fromTime} slot - skipped`); continue; }
      if ((slot.occurrences || []).some(i => alab(aById.get(i)) === name)) { log(`  ${name} already on ${CARDIO_ONTO}`); continue; }
      const srcMod = amById.get(from.moduleId);
      const nMod = uid(), nOcc = uid();
      const { _id, __v, createdAt, updatedAt, ...modShape } = srcMod;
      await Module.create({ ...modShape, id: nMod,
        fieldBindings: (srcMod.fieldBindings || []).map(({ _id: _d, ...b }) => b) });
      await Occurrence.create({ id: nOcc, gridId, userId: from.userId, moduleId: nMod,
        parentId: slot.id, occurrences: [], fields: structuredClone(from.fields || {}) });
      await Occurrence.updateOne({ id: slot.id, gridId }, { $push: { occurrences: nOcc } });
      log(`  placed ${name} at ${fromTime} on ${CARDIO_ONTO}`);
    }
  }
  log("  done - 0162 wires the op. RESTART pm2 and reload.");
}
