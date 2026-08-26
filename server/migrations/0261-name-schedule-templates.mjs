/**
 * 0261 — the schedule templates get their names, and Sunday gets its occurrence.
 *
 * User, 2026-08-26: *"name them Schedule: Workouts - Day of the Week. and the
 * other 2, Schedule: Layout (what was Day) and Schedule: Routine"*, and
 * *"we also need a Schedule - Sunday Template"*.
 *
 * ── THE DAY IS NOT PARSED OUT OF THE NAME, IT IS READ FROM THE FIELD ────
 *
 * Each workout template already carries a `Weekday` multi-select — that is what
 * `Schedule: Place Weekday` matches on (2026-08-20). So the new name is BUILT
 * from that field rather than mapped from the old label:
 *
 * ```
 * Workout — Chest · Shoulders · Arms   Weekday ["Monday"]     -> Schedule: Workouts - Monday
 * Workout — Legs                       ["Tuesday"]            -> … Tuesday
 * Workout — Back · Arms                ["Wednesday"]          -> … Wednesday
 * Workout — Core                       ["Thursday"]           -> … Thursday
 * Cardio                               ["Friday"]             -> … Friday
 * ```
 *
 * `Cardio` is the discriminating case: it is a workout template by its Weekday,
 * not by its label, and a rule keyed on the word "Workout" would have missed it.
 * A template claiming MORE THAN ONE weekday is not a per-day workout and is left
 * alone — which is what protects `Meals` and `Routine`, both of which claim all
 * seven.
 *
 * ── THE NAME LIVES ON THE OCCURRENCE ────────────────────────────────────
 *
 * `occurrence.label ?? module.label` is what renders, and these occurrences
 * carry their own label while the MODULES are named `Schedule - Monday` …
 * `Schedule - Saturday`. So the rename writes the occurrence label and leaves
 * the module names alone — nothing resolves these by module label, and the
 * module names are what `Schedule - Sunday` is found by below.
 *
 * ── SUNDAY WAS A MISSING OCCURRENCE, NOT A MISSING TEMPLATE ─────────────
 *
 * ```
 * "Schedule - Saturday"  module da53d760…  placements 1
 * "Schedule - Sunday"    module afab4829…  placements 0   <- meta.templateModule: true
 * ```
 *
 * The module exists, carries `templateModule: true`, and `sweepOrphans` has been
 * deliberately KEEPING it ("is a template root"). So Sunday needs a placement,
 * not a new module — minting a second one would leave the first orphaned
 * forever.
 *
 * Its 49 slots are CLONED from an existing template's slots (fields and order
 * copied, contents NOT) so a Sunday column is built from the same shape as every
 * other day rather than a reconstruction.
 *
 * `Meals` is deliberately NOT renamed: the user named the workouts "and the
 * other 2", and Meals is a third. Flagged rather than folded in.
 */

const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

export const id = "0261-name-schedule-templates";
export const describe =
  "Renames the schedule templates to 'Schedule: Workouts - <Weekday>' (built from each one's Weekday field), 'Schedule: Layout' and 'Schedule: Routine', and gives the existing but unplaced 'Schedule - Sunday' template module an occurrence with its own 49 slots.";
export const touches = ["occurrences"];

export const RENAMES = Object.freeze({ Day: "Schedule: Layout", Routine: "Schedule: Routine" });
export const WORKOUT_PREFIX = "Schedule: Workouts - ";
export const SUNDAY_MODULE_LABEL = "Schedule - Sunday";

const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/** Pure. What each template should be called, and whether Sunday needs minting. */
export function planTemplateNames({ occurrences, modules, fields }) {
  const refusals = [];
  const modById = new Map(modules.map((m) => [m.id, m]));
  const occById = new Map(occurrences.map((o) => [o.id, o]));
  const labelOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "";
  const TS = fields.find((f) => f.name === "Time Slot")?.id;
  const WD = fields.find((f) => f.name === "Weekday")?.id;
  if (!TS) { refusals.push("no 'Time Slot' field"); return { refusals }; }

  const isTemplate = (o) => {
    const m = modById.get(o.moduleId);
    if (m?.role !== "container") return false;
    const kids = (o.occurrences || []).map((i) => occById.get(i)).filter(Boolean);
    return kids.length >= 40 && kids.filter((k) => k.fields?.[TS]?.value).length >= 30;
  };
  // A template is one of the SCHEDULE TEMPLATES (not a live day column) when the
  // page listing it is the templates page — i.e. it is not the Schedule itself.
  const templates = occurrences.filter((o) => {
    if (!isTemplate(o)) return false;
    const page = occurrences.find((x) => (x.occurrences || []).includes(o.id));
    return !!page && /template/i.test(labelOf(page));
  });

  const renames = [];
  for (const t of templates) {
    const cur = labelOf(t);
    const days = WD ? asArray(t.fields?.[WD]?.value) : [];
    let next = null;
    if (days.length === 1) next = `${WORKOUT_PREFIX}${days[0]}`;          // a per-day workout
    else if (RENAMES[cur]) next = RENAMES[cur];                           // Day / Routine
    if (next && next !== cur) renames.push({ id: t.id, from: cur, to: next, days });
  }

  // Sunday: the module exists and is unplaced.
  const sundayMod = modules.find((m) => m.label === SUNDAY_MODULE_LABEL && m.role === "container");
  let sunday = null;
  if (!sundayMod) refusals.push(`no template module labelled "${SUNDAY_MODULE_LABEL}"`);
  else {
    const placed = occurrences.filter((o) => o.moduleId === sundayMod.id);
    if (placed.length) sunday = { already: true, id: placed[0].id };
    else {
      // Clone the slots of an existing per-day workout template.
      const exemplar = templates.find((t) => WD && asArray(t.fields?.[WD]?.value).length === 1);
      const page = exemplar && occurrences.find((x) => (x.occurrences || []).includes(exemplar.id));
      if (!exemplar || !page) refusals.push("no single-weekday template to copy Sunday's slots from");
      else sunday = { already: false, moduleId: sundayMod.id, exemplarId: exemplar.id, pageId: page.id, slotFieldId: TS, weekdayFieldId: WD };
    }
  }
  return { refusals, renames, sunday, templateCount: templates.length };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Grid } = models;
  const [occurrences, modules, fields, grid] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(), Grid.findById(gridId).lean(),
  ]);
  const p = planTemplateNames({ occurrences, modules, fields });
  if (p.refusals.length) { for (const r of p.refusals) log(`  REFUSING — ${r}`); return; }
  const occById = new Map(occurrences.map((o) => [o.id, o]));

  log(`${p.templateCount} schedule template(s) found`);
  for (const r of p.renames) log(`  RENAME "${r.from}" -> "${r.to}"${r.days.length ? `  (Weekday ${r.days.join(",")})` : ""}`);
  const untouched = p.templateCount - p.renames.length;
  if (untouched) log(`  ${untouched} left alone (a template claiming several weekdays is not a per-day workout)`);

  if (p.sunday?.already) log(`  Sunday already placed (${p.sunday.id})`);
  else if (p.sunday) log(`  MINT Sunday from the existing "${SUNDAY_MODULE_LABEL}" module, cloning slots from ${p.sunday.exemplarId}`);

  if (dryRun) { log("DRY RUN — nothing written."); return; }

  for (const r of p.renames) await Occurrence.updateOne({ gridId, id: r.id }, { $set: { label: r.to } });
  log(`renamed ${p.renames.length} template(s).`);

  if (p.sunday && !p.sunday.already) {
    const exemplar = occById.get(p.sunday.exemplarId);
    const slotIds = [];
    for (const sid of exemplar.occurrences || []) {
      const src = occById.get(sid);
      if (!src) continue;
      const nid = uid();
      await Occurrence.create({
        id: nid, userId: grid.userId, gridId, moduleId: src.moduleId,
        parentId: null, sortOrder: src.sortOrder ?? 0, label: src.label ?? null,
        fields: JSON.parse(JSON.stringify(src.fields || {})),
        occurrences: [],                       // slots are cloned EMPTY — shape, not contents
        meta: {},
      });
      slotIds.push(nid);
    }
    const rootId = uid();
    await Occurrence.create({
      id: rootId, userId: grid.userId, gridId, moduleId: p.sunday.moduleId,
      parentId: null, sortOrder: 99, label: `${WORKOUT_PREFIX}Sunday`,
      fields: p.sunday.weekdayFieldId ? { [p.sunday.weekdayFieldId]: { value: ["Sunday"], flow: "in" } } : {},
      occurrences: slotIds, meta: {},
    });
    for (const sid of slotIds) await Occurrence.updateOne({ gridId, id: sid }, { $set: { parentId: rootId } });
    await Occurrence.updateOne({ gridId, id: p.sunday.pageId }, { $push: { occurrences: rootId } });
    log(`minted "${WORKOUT_PREFIX}Sunday" (${rootId}) with ${slotIds.length} empty slots, listed by the templates page.`);
  }
}
