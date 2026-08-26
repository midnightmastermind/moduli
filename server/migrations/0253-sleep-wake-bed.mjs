/**
 * 0253 — Sleep spans the night on the Routine template; Wake Up and Go to Bed join it.
 *
 * User, 2026-08-26: *"add sleep to the routine schedule template, from 1130pm to
 * 530am, add a wake up at 6am and go to bed occurance at 11pm (new occurznce
 * too)"*, and, when asked what carries the length:
 * *"forget duration for sleep time. we imply duration is a half hour by dragging
 * it to the grid"*.
 *
 * ── A SLOT IS THE UNIT, SO SLEEP IS TWELVE PLACEMENTS ────────────────────
 *
 * That instruction restates a decision this grid already made. 2026-07-30 (3):
 * *"Sleep no longer binds Duration (user: 'the operation should just count each
 * one as 30 min') — a slot IS 30 minutes, so sleep is measured by how many
 * half-hour slots it fills."* So 11:30pm -> 5:30am is not one row with a length,
 * it is **12 rows of half an hour**: 11:30pm and 12:00am..5:00am. The 5:00am
 * slot ends at 5:30, which is where the night ends.
 *
 * Nothing new is invented to express it — no Duration binding, no span field.
 *
 * ── EVERY SHAPE IS COPIED FROM A ROW THAT ALREADY EXISTS ─────────────────
 *
 * The two new actions copy the **Sleep action module's own bindings** rather
 * than listing fields. That is not tidiness: the routine bindings carry a HIDDEN
 * `Habit` marker, and 2026-08-20 records what happens without it — *"a routine
 * minted without it lands silently in the TASKS count instead"* of Completed
 * Habits. Copying the exemplar makes that impossible to forget.
 *
 * A placement is likewise copied from the template's existing rows: a clone that
 * SHARES the catalog action's module (the grid already places one `Take
 * Medication` module in two slots), parented to the slot AND listed in it, with
 * the slot's own `Time Slot` value stamped on it.
 *
 * ── "A TIME FIELD" IS `Time Slot`, MADE VISIBLE ──────────────────────────
 *
 * The earlier half of the ask was *"add a wake up with a time field"*. This grid
 * has **no time-typed field** — the types are number/text/boolean/select/date/
 * rating/duration/occurrence/markdown/button/address — and the thing that means
 * "what time" here is `Time Slot`, a select of the 48 half-hour labels that
 * every placed routine already carries as a VALUE while binding it nowhere.
 *
 * So Wake Up BINDS it, visibly, rather than minting a twelfth almost-time field.
 * If what was wanted is the time actually woken (6:12am) as distinct from the
 * slot, that is a different field and a different ask — flagged rather than
 * guessed, because a field that duplicates `Time Slot` would be read as the
 * schedule and written as a log.
 *
 * Idempotent: a slot that already holds the action is skipped, so a re-run
 * places nothing.
 */

const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

export const id = "0253-sleep-wake-bed";
export const describe =
  "Places Sleep across 11:30pm-5:30am on the Routine template as twelve half-hour rows, and adds Wake Up (6:00am, with Time Slot visible) and Go to Bed (11:00pm) as new routine actions.";
export const touches = ["occurrences", "modules", "fields"];

/** 11:30pm then 12:00am..5:00am — twelve half-hour slots, i.e. six hours. */
export const SLEEP_SLOTS = Object.freeze([
  "11:30pm",
  "12:00am", "12:30am", "1:00am", "1:30am", "2:00am", "2:30am",
  "3:00am", "3:30am", "4:00am", "4:30am", "5:00am",
]);
export const WAKE_SLOT = "6:00am";
export const BED_SLOT = "11:00pm";

/**
 * Resolve everything structurally and say what would change. Pure.
 * Returns `{ refusals, template, catalogParentId, sleepModuleId, exemplar, plan }`.
 */
export function planSleepWakeBed({ occurrences, modules, fields }) {
  const refusals = [];
  const modById = new Map(modules.map((m) => [m.id, m]));
  const occById = new Map(occurrences.map((o) => [o.id, o]));
  const timeSlotField = fields.find((f) => f.name === "Time Slot" && f.type === "select");
  if (!timeSlotField) { refusals.push("no select field named 'Time Slot'"); return { refusals }; }

  // The Routine TEMPLATE: a container whose module is labelled "Routine" and
  // which holds a full day of slots. Never by id.
  const templates = occurrences.filter((o) => {
    const m = modById.get(o.moduleId);
    if (m?.role !== "container") return false;
    if ((o.label ?? m.label) !== "Routine") return false;
    const kids = (o.occurrences || []).map((k) => occById.get(k)).filter(Boolean);
    return kids.filter((k) => k.fields?.[timeSlotField.id]?.value).length >= 40;
  });
  if (templates.length !== 1) {
    refusals.push(`expected exactly one "Routine" template holding a day of slots, found ${templates.length}`);
    return { refusals };
  }
  const template = templates[0];

  // The Sleep ACTION (not the tracker tile of the same name): an instance module
  // labelled "Sleep" that binds the routine markers.
  const sleepMods = modules.filter((m) => {
    if (m.role !== "instance" || m.label !== "Sleep") return false;
    const ids = (m.fieldBindings || []).map((b) => b.fieldId);
    const named = ids.map((fid) => fields.find((f) => f.id === fid)?.name);
    return named.includes("Completed") && named.includes("Habit");
  });
  if (sleepMods.length !== 1) {
    refusals.push(`expected exactly one Sleep ACTION module (Completed + Habit), found ${sleepMods.length}`);
    return { refusals };
  }
  const exemplar = sleepMods[0];

  // Where the catalog keeps it — the new actions go beside it.
  const catalogOcc = occurrences.find((o) => o.moduleId === exemplar.id && o.parentId);
  if (!catalogOcc) { refusals.push("the Sleep action has no catalog placement to sit beside"); return { refusals }; }
  const catalogParentId = catalogOcc.parentId;

  // Slots by their Time Slot value.
  const slotByLabel = new Map();
  for (const k of (template.occurrences || []).map((i) => occById.get(i)).filter(Boolean)) {
    const v = k.fields?.[timeSlotField.id]?.value;
    if (v) slotByLabel.set(String(v), k);
  }

  const plan = [];
  const missingSlots = [];
  const add = (label, moduleId, what) => {
    const slot = slotByLabel.get(label);
    if (!slot) { missingSlots.push(label); return; }
    const already = (slot.occurrences || []).some((cid) => occById.get(cid)?.moduleId === moduleId);
    plan.push({ slotLabel: label, slotId: slot.id, moduleId, what, already });
  };
  for (const label of SLEEP_SLOTS) add(label, exemplar.id, "Sleep");
  add(BED_SLOT, "@bed", "Go to Bed");
  add(WAKE_SLOT, "@wake", "Wake Up");
  if (missingSlots.length) refusals.push(`the Routine template has no slot for: ${missingSlots.join(", ")}`);

  return { refusals, template, catalogParentId, timeSlotFieldId: timeSlotField.id, exemplar, plan };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Grid } = models;
  const [occurrences, modules, fields, grid] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(), Grid.findById(gridId).lean(),
  ]);
  const p = planSleepWakeBed({ occurrences, modules, fields });
  if (p.refusals.length) { for (const r of p.refusals) log(`  REFUSING — ${r}`); return; }

  const modById = new Map(modules.map((m) => [m.id, m]));
  const fname = (id) => fields.find((f) => f.id === id)?.name ?? id;
  log(`Routine template ${p.template.id}; catalog parent ${p.catalogParentId}`);
  log(`exemplar "${p.exemplar.label}" bindings: ${(p.exemplar.fieldBindings || []).map((b) => fname(b.fieldId)).join(", ")}`);

  // The two new actions, if they are not already here.
  const existing = (label) => modules.find((m) => m.role === "instance" && m.label === label);
  const wanted = [
    { label: "Wake Up", showTimeSlot: true },
    { label: "Go to Bed", showTimeSlot: false },
  ];
  const moduleIdFor = {};
  for (const w of wanted) {
    const had = existing(w.label);
    if (had) { moduleIdFor[w.label] = had.id; log(`  "${w.label}" module already exists (${had.id})`); continue; }
    const mid = uid();
    moduleIdFor[w.label] = mid;
    // Copy the exemplar's bindings wholesale — that is what carries the hidden
    // Habit marker, without which the routine lands in the TASKS count.
    // The exemplar ALREADY binds Time Slot (hidden, like every routine). So
    // "a time field" is that binding UN-HIDDEN — appending a second one would
    // render the same field twice on the row, which is what the first dry run
    // showed as 8 bindings against Go to Bed's 7.
    const bindings = (p.exemplar.fieldBindings || []).map((b) => {
      const unhide = w.showTimeSlot && b.fieldId === p.timeSlotFieldId;
      return {
        fieldId: b.fieldId,
        order: unhide ? 1 : b.order,
        role: b.role,
        ...(b.hidden && !unhide ? { hidden: true } : {}),
      };
    });
    if (w.showTimeSlot && !bindings.some((b) => b.fieldId === p.timeSlotFieldId)) {
      bindings.push({ fieldId: p.timeSlotFieldId, order: 1, role: "input" });
    }
    log(`  MINT module "${w.label}" — ${bindings.length} binding(s)${w.showTimeSlot ? " (Time Slot visible)" : ""}`);
    if (!dryRun) {
      await Module.create({ id: mid, userId: grid.userId, gridId, role: "instance", label: w.label, fieldBindings: bindings, meta: {} });
      await Occurrence.create({ id: uid(), userId: grid.userId, gridId, moduleId: mid,
        parentId: p.catalogParentId, sortOrder: 0, fields: {}, occurrences: [], meta: {} });
      await Occurrence.updateOne({ gridId, id: p.catalogParentId }, { $push: { occurrences: (await Occurrence.findOne({ gridId, moduleId: mid }).lean()).id } });
    }
  }

  let placed = 0, skipped = 0;
  for (const item of p.plan) {
    const mid = item.moduleId.startsWith("@")
      ? moduleIdFor[item.what]
      : item.moduleId;
    if (item.already) { log(`  already placed: ${item.what} @ ${item.slotLabel}`); skipped++; continue; }
    log(`  PLACE ${item.what} @ ${item.slotLabel}`);
    placed++;
    if (dryRun) continue;
    const oid = uid();
    await Occurrence.create({
      id: oid, userId: grid.userId, gridId, moduleId: mid,
      parentId: item.slotId, sortOrder: 0, label: null, occurrences: [], meta: {},
      fields: { [p.timeSlotFieldId]: { value: item.slotLabel, flow: "in" } },
    });
    await Occurrence.updateOne({ gridId, id: item.slotId }, { $push: { occurrences: oid } });
  }
  log(`\nplan: place ${placed}, already there ${skipped}`);
  if (dryRun) log("DRY RUN — nothing written.");
}
