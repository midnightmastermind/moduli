// server/migrations/0104-four-day-cycle-templates.mjs
//
// User, 2026-08-13: "id like to have 7 diff schedule templates for each day of
// the week … " then, given the measurement: "if the meal plan is the same
// everyday then lets do the meal plan identically. just create 4 diff templates
// then if we dont have enough for 7 diff days … create enough for the workout
// variety. make sure the workouts are all in the same timeslot in the morning at
// 7am."
//
// FOUR, NOT SEVEN, AND THE DOC IS WHY. Nutrition Plan.md says "Day 1-3 (Same
// Meals for Simplicity)" — every day eats the same eight meals, so the meals
// generate no template variety at all. The only thing that differs is the
// workout, and Fitness Plan.md is a 4-day cycle. Seven templates would have been
// three duplicates wearing different names.
//
//   Day 1 — Push    chest / shoulders / triceps  (+ optional core)
//   Day 2 — Legs    legs (+ abs)
//   Day 3 — Pull    back / biceps  (+ optional core)
//   Day 4 — Rest    stretching, foam rolling, light cardio — no lifts
//
// EACH IS A CLONE OF THE EXISTING "Day" CONTAINER, slot signatures and all. The
// build op matches slots by `identitySignature: "slot:<label>"`, so a template
// that invents its own slot shape would merge into a day column as duplicates
// rather than filling the slots that are already there. Cloning is what keeps
// APPLY_TEMPLATE's identity matching intact.
//
// MEALS AT THE DOC'S OWN TIMES; WORKOUTS ALL AT 7:00am per the user — so the
// 7:00am slot legitimately carries Hygiene, breakfast and the day's lifts at
// once. A slot holds any number of items; that is what makes it a slot.
//
// THE EXISTING DAILY ROUTINES ARE KEPT (Drink 6am, Hygiene 7am, Eat 8am, Walk
// 12pm, Journal 9pm) — they are the user's own routine and nothing in the ask
// replaced them. "Exercise" at 5pm is DROPPED from the new templates only
// because the workout now has real movements at 7am, and leaving a generic
// Exercise beside them would double-count in every workout tracker.
//
// THE ROTATION IS NOT WIRED HERE, said plainly: `Schedule: Build Schedule` still
// applies the original "Day" template by id. Choosing template N for today needs
// a cycle marker on the grid (the pattern `Grid: Snap Filter To Today` already
// uses for "Last Opened Date"), and that is its own reviewed change — building
// the templates first means the rotation has something real to point at.
import { randomUUID } from "node:crypto";

export const id = "0104-four-day-cycle-templates";
export const describe =
  "Four schedule templates — Push / Legs / Pull / Rest — with the plan's meals on every one.";

export const MEALS_BY_SLOT = [
  ["7:00am",  "Greek Yogurt Bowl"],
  ["9:00am",  "Peanuts & Apple"],
  ["11:00am", "Mediterranean Chicken Wrap"],
  ["1:00pm",  "Hard-Boiled Eggs & Pecans"],
  ["3:00pm",  "Protein Shake"],
  ["5:00pm",  "Grilled Chicken & Roasted Veggies"],
  ["7:00pm",  "Peanuts & Apple"],
  ["9:00pm",  "Protein Shake"],
];

export const CYCLE = [
  { n: 1, name: "Push", movements: ["Barbell Bench Press", "Dumbbell Shoulder Press",
    "Incline Dumbbell Press", "Lateral Raises", "Tricep Dips", "Tricep Pushdowns",
    "Planks", "Russian Twists"] },
  { n: 2, name: "Legs", movements: ["Barbell Squats", "Romanian Deadlifts", "Leg Press",
    "Walking Lunges", "Leg Curls", "Calf Raises", "Leg Raises", "Bicycle Crunches"] },
  { n: 3, name: "Pull", movements: ["Deadlifts", "Pull-Ups", "Bent-Over Rows",
    "Single-Arm Dumbbell Rows", "Bicep Curls", "Hammer Curls", "Ab Rollouts", "Side Planks"] },
  { n: 4, name: "Rest", movements: [] },
];

const WORKOUT_SLOT = "7:00am";
const DROP_FROM_TEMPLATE = new Set(["exercise"]);

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const byId = new Map(occs.map((o) => [o.id, o]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "?";
  const TS = fields.find((f) => f.name === "Time Slot")?.id;
  if (!TS) { log(`REFUSING: no "Time Slot" field.`); return; }

  const stPage = occs.find((o) => nameOf(o) === "Schedule Template");
  const source = stPage ? byId.get((stPage.occurrences || [])[0]) : null;
  if (!source) { log(`REFUSING: no "Day" template under "Schedule Template".`); return; }

  // Catalog rows to place, resolved by label from the boards 0103 seeded.
  const board = (label) => occs.find((o) => nameOf(o) === label);
  const catalog = new Map();
  for (const b of ["Meals", "Movements"]) {
    for (const cid of board(b)?.occurrences || []) {
      const c = byId.get(cid);
      if (c) catalog.set(nameOf(c).trim().toLowerCase(), c);
    }
  }
  const need = [...new Set([...MEALS_BY_SLOT.map(([, m]) => m), ...CYCLE.flatMap((c) => c.movements)])];
  const absent = need.filter((n) => !catalog.has(n.trim().toLowerCase()));
  if (absent.length) { log(`REFUSING: not on any board — ${absent.join(", ")}`); return; }

  const existing = CYCLE.filter((c) =>
    mods.some((m) => m.label === `Day ${c.n} — ${c.name}` && m.meta?.templateModule === true));
  log(`source template "${nameOf(source)}" with ${(source.occurrences || []).length} slots`);
  log(`catalog resolved: ${need.length} row(s) · templates already present: ${existing.length}`);
  for (const c of CYCLE) {
    log(`  Day ${c.n} — ${String(c.name).padEnd(5)} ${MEALS_BY_SLOT.length} meal(s) · ` +
      `${c.movements.length} movement(s) at ${WORKOUT_SLOT}`);
  }
  if (existing.length === CYCLE.length) { log(`all four already exist — no change.`); if (dryRun) return; }

  if (dryRun) {
    log(`WOULD clone the Day template ${CYCLE.length - existing.length} time(s), each with its ` +
      `slots, the daily routines, the eight meals, and its own movements.`);
    return;
  }

  const userId = source.userId;
  const srcSlots = (source.occurrences || []).map((i) => byId.get(i)).filter(Boolean);

  for (const cyc of CYCLE) {
    const label = `Day ${cyc.n} — ${cyc.name}`;
    if (mods.some((m) => m.label === label && m.meta?.templateModule === true)) continue;

    // The root: a template module, so gridIntegrity recognises it as a template
    // root and does not demand identity signatures of its clones' children.
    const rootMod = randomUUID(), rootOcc = randomUUID();
    await Module.create({ id: rootMod, gridId, userId, label,
      role: "container", kind: "board",
      meta: { templateModule: true, allowChildContainers: true },
      ownStyle: modById.get(source.moduleId)?.ownStyle || null,
      styleMode: modById.get(source.moduleId)?.styleMode || "inherit" });

    const slotIds = [];
    for (const slot of srcSlots) {
      const sLabel = nameOf(slot);
      const sMod = randomUUID(), sOcc = randomUUID();
      await Module.create({ id: sMod, gridId, userId, label: sLabel,
        role: "container", kind: modById.get(slot.moduleId)?.kind || "board",
        meta: { ...(modById.get(slot.moduleId)?.meta || {}) } });

      // What this slot carries: kept routines, meals at their time, and the
      // day's movements at 7:00am.
      const slotTime = slot.fields?.[TS]?.value;
      const kept = (slot.occurrences || []).map((i) => byId.get(i)).filter(Boolean)
        .filter((k) => !DROP_FROM_TEMPLATE.has(nameOf(k).trim().toLowerCase()));
      const children = [];
      for (const k of kept) {
        const kMod = randomUUID(), kOcc = randomUUID();
        const km = modById.get(k.moduleId);
        await Module.create({ id: kMod, gridId, userId, label: nameOf(k), role: km?.role || "instance",
          fieldBindings: km?.fieldBindings || [], meta: { ...(km?.meta || {}) },
          ownStyle: km?.ownStyle || null, styleMode: km?.styleMode || "inherit" });
        await Occurrence.create({ id: kOcc, gridId, userId, moduleId: kMod, targetId: kMod,
          parentId: sOcc, occurrences: [], fields: { ...(k.fields || {}) } });
        children.push(kOcc);
      }
      const place = [
        ...MEALS_BY_SLOT.filter(([t]) => t === slotTime).map(([, m]) => m),
        ...(slotTime === WORKOUT_SLOT ? cyc.movements : []),
      ];
      for (const label2 of place) {
        const src = catalog.get(label2.trim().toLowerCase());
        const srcMod = modById.get(src.moduleId);
        const nMod = randomUUID(), nOcc = randomUUID();
        await Module.create({ id: nMod, gridId, userId, label: label2,
          role: "instance", fieldBindings: srcMod?.fieldBindings || [],
          meta: { ...(srcMod?.meta || {}) },
          ownStyle: srcMod?.ownStyle || null, styleMode: srcMod?.styleMode || "inherit" });
        await Occurrence.create({ id: nOcc, gridId, userId, moduleId: nMod, targetId: nMod,
          parentId: sOcc, occurrences: [], fields: { ...(src.fields || {}) } });
        children.push(nOcc);
      }

      await Occurrence.create({ id: sOcc, gridId, userId, moduleId: sMod, targetId: sMod,
        parentId: rootOcc, occurrences: children,
        // The signature the build op matches slots on — cloned verbatim, or a
        // merge would duplicate every slot instead of filling it.
        identitySignature: slot.identitySignature || null,
        fields: { ...(slot.fields || {}) } });
      slotIds.push(sOcc);
    }

    await Occurrence.create({ id: rootOcc, gridId, userId, moduleId: rootMod, targetId: rootMod,
      parentId: stPage.id, occurrences: slotIds,
      identitySignature: source.identitySignature || null,
      fields: { ...(source.fields || {}) } });
    await Occurrence.updateOne({ gridId, id: stPage.id }, { $push: { occurrences: rootOcc } });
    log(`  built "${label}" — ${slotIds.length} slots`);
  }
  log(`four cycle templates built under "Schedule Template".`);
}
