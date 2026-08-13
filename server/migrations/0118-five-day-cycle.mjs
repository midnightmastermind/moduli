// server/migrations/0118-five-day-cycle.mjs
//
// User, 2026-08-13: "do i really have 8 workouts a day? or is that just for
// today? make one of the rest days a core and cardio day, so 5 templates
// total" … "and for rest day, dont have anythign for excersise."
//
// ANSWERING THE QUESTION FIRST, because it decided the shape: it was EVERY
// training day, not just today. Fitness Plan.md lists **6 numbered exercises**
// per training day and then a SEPARATE "Optional Core" block of 2 — and `0104`
// folded the optional pair into `CYCLE.movements` with no distinction, so Days
// 1-3 each carried 8.
//
// THE FIX IS THE USER'S STRUCTURE, and it happens to be the plan's own: the six
// optional-core movements (two per training day) are exactly a core session, so
// they move OUT of Days 1-3 and become their own day.
//
//   Day 1  Push    6 lifts   chest / shoulders / triceps
//   Day 2  Legs    6 lifts
//   Day 3  Pull    6 lifts   back / biceps
//   Day 4  Core & Cardio   the 6 core movements + Run + Stretch   <- NEW
//   Day 5  Rest    NOTHING for exercise, per the user             <- NEW
//
// CARDIO IS BUILT FROM WHAT EXISTS, not invented. `Muscle Group` has a "cardio"
// option but the Movements board has NO cardio movement, so a cardio Exercise
// row would have nothing to pick and would render as the empty row this session
// already removed once. Physical > Fitness already holds **Run** and **Stretch**
// as routines, which is what the plan's Day 4 actually describes ("stretching,
// foam rolling, light cardio"), so those are placed as routines.
//
// DAY 5 GETS NO EXERCISE AT ALL — the user was explicit. It carries the meals
// and the daily routines and nothing else, which is also why it is a CLONE of
// the old Day 4 (already meals-only) rather than something new.
//
// TODAY IS Day 1, so its two core movements (Planks, Russian Twists) come off
// the live column in the same pass — otherwise the fix would be visible in the
// templates and not on the screen the user is looking at.
//
// THE ROTATION IS REBUILT FROM `0112`'s OWN BUILDER over five names rather than
// re-authored here, so the pipeline cannot drift from the one that was tested.
import { randomUUID } from "node:crypto";
import { buildPipeline, OP_NAME, CYCLE_FIELD, MARKER_LABEL } from "./0112-schedule-cycle-rotation.mjs";

export const id = "0118-five-day-cycle";
export const describe =
  "Five templates: Push / Legs / Pull / Core & Cardio / Rest — training days drop to 6 lifts.";

export const CORE_MOVEMENTS = [
  "Planks", "Russian Twists", "Leg Raises", "Bicycle Crunches", "Ab Rollouts", "Side Planks",
];
export const CARDIO_ROUTINES = ["Run", "Stretch"];
export const WORKOUT_SLOT = "7:00am";
export const TODAY_DATE = "2026-08-13";
export const NAMES = ["Day 1", "Day 2", "Day 3", "Day 4", "Day 5"];

const norm = (s) => String(s ?? "").trim().toLowerCase();

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field, Operation } = models;
  const [occs, mods, fields, ops] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(), Operation.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const byId = new Map(occs.map((o) => [o.id, o]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "?";
  const fid = (n) => fields.find((f) => f.name === n && !f.displayEnabled)?.id;
  const TS = fid("Time Slot"), DATE = fid("Date"), FMT = fid("Schedule Format");
  const MOV = fid("Movement"), CYCLE_FID = fid(CYCLE_FIELD);
  const TAG = fields.find((f) => f.name === "Board Category")?.id;
  if (!TS || !DATE || !FMT || !MOV || !TAG) { log(`REFUSING: a required field is missing.`); return; }

  const tplOcc = (n) => {
    const m = mods.find((x) => x.label === `Schedule - ${n}` && x.meta?.templateModule === true);
    return m ? occs.find((o) => o.moduleId === m.id) : null;
  };
  const day4 = tplOcc("Day 4");
  if (!day4) { log(`REFUSING: no "Schedule - Day 4" to build from.`); return; }
  const stPage = occs.find((o) => nameOf(o) === "Schedule Template");

  const isCore = (o) => {
    const v = o.fields?.[MOV]?.value; const ids = Array.isArray(v) ? v : v ? [v] : [];
    return ids.some((i) => CORE_MOVEMENTS.some((c) => norm(c) === norm(nameOf(byId.get(i)))));
  };

  // 1. the core pair comes off each training day, and off today's column
  const strip = [];
  const roots = [["Day 1", tplOcc("Day 1")], ["Day 2", tplOcc("Day 2")], ["Day 3", tplOcc("Day 3")]];
  const todayCol = occs.find((o) => o.fields?.[FMT]?.value === "day-col" &&
    String(o.fields?.[DATE]?.value ?? "").slice(0, 10) === TODAY_DATE);
  if (todayCol) roots.push(["today", todayCol]);
  for (const [where, root] of roots) {
    if (!root) { log(`  REFUSING ${where} — not found`); continue; }
    for (const s of (root.occurrences || []).map((i) => byId.get(i)).filter(Boolean)) {
      for (const k of (s.occurrences || []).map((i) => byId.get(i)).filter(Boolean)) {
        if (isCore(k)) strip.push({ where, occ: k, slot: s, label: nameOf(byId.get((Array.isArray(k.fields[MOV].value) ? k.fields[MOV].value : [k.fields[MOV].value])[0])) });
      }
    }
  }

  // 2. Day 4 becomes Core & Cardio; a clone of today's Day 4 becomes Day 5 Rest
  const coreSrc = new Map();
  for (const o of occs) {
    const v = o.fields?.[TAG]?.value; const a = Array.isArray(v) ? v : v ? [v] : [];
    if (a.includes("movement") && !o.meta?.feedSourceId && modById.get(o.moduleId)?.role === "instance")
      coreSrc.set(norm(nameOf(o)), o);
  }
  const missingCore = CORE_MOVEMENTS.filter((c) => !coreSrc.has(norm(c)));
  const routines = occs.find((o) => nameOf(o) === "Routines");
  const physical = (routines?.occurrences || []).map((i) => byId.get(i))
    .find((d) => /^physical$/i.test(nameOf(d)));
  const catalog = new Map();
  for (const cid of physical?.occurrences || []) {
    for (const k of (byId.get(cid)?.occurrences || []).map((i) => byId.get(i)).filter(Boolean))
      catalog.set(nameOf(k), k);
  }
  const missingRoutine = CARDIO_ROUTINES.filter((r) => !catalog.get(r));
  if (missingCore.length || missingRoutine.length) {
    log(`REFUSING: not on the grid — ${[...missingCore, ...missingRoutine].join(", ")}`);
    return;
  }
  const day5Exists = !!tplOcc("Day 5");
  const exerciseSrc = catalog.get("Exercise");
  if (!exerciseSrc) { log(`REFUSING: no "Exercise" routine to clone rows from.`); return; }

  log(`stripping ${strip.length} core row(s): ` +
    [...new Set(strip.map((s) => `${s.where}:${s.label}`))].join(", "));
  log(`Day 4 -> "Core & Cardio": ${CORE_MOVEMENTS.length} core movement(s) at ${WORKOUT_SLOT} + ${CARDIO_ROUTINES.join(", ")}`);
  log(`Day 5 -> "Rest": ${day5Exists ? "already exists" : "WILL CREATE as a clone of Day 4 (meals + routines, no exercise)"}`);
  log(`rotation: ${NAMES.join(" -> ")} -> ${NAMES[0]}`);
  if (dryRun) { log(`WOULD restructure to a 5-day cycle.`); return; }

  // --- strip ---------------------------------------------------------------
  for (const s of strip) {
    await Occurrence.updateOne({ gridId, id: s.slot.id }, { $pull: { occurrences: s.occ.id } });
    await Occurrence.deleteOne({ gridId, id: s.occ.id });
  }

  // --- Day 5 = Rest, cloned from Day 4 BEFORE Day 4 gains its core work -----
  const userId = day4.userId;
  const cloneRoot = async (src, label) => {
    const rootMod = randomUUID(), rootOcc = randomUUID();
    const srcMod = modById.get(src.moduleId);
    await Module.create({ id: rootMod, gridId, userId, label,
      role: srcMod?.role || "container", kind: srcMod?.kind || "board",
      meta: { ...(srcMod?.meta || {}), templateModule: true },
      ownStyle: srcMod?.ownStyle || null, styleMode: srcMod?.styleMode || "inherit" });
    const slotIds = [];
    for (const sid of src.occurrences || []) {
      const s = byId.get(sid); if (!s) continue;
      const sMod = randomUUID(), sOcc = randomUUID();
      const sm = modById.get(s.moduleId);
      await Module.create({ id: sMod, gridId, userId, label: nameOf(s),
        role: sm?.role || "container", kind: sm?.kind || "board", meta: { ...(sm?.meta || {}) } });
      const kids = [];
      for (const k of (s.occurrences || []).map((i) => byId.get(i)).filter(Boolean)) {
        const kMod = randomUUID(), kOcc = randomUUID();
        const km = modById.get(k.moduleId);
        await Module.create({ id: kMod, gridId, userId, label: nameOf(k),
          role: km?.role || "instance", fieldBindings: km?.fieldBindings || [],
          meta: { ...(km?.meta || {}) }, ownStyle: km?.ownStyle || null,
          styleMode: km?.styleMode || "inherit" });
        await Occurrence.create({ id: kOcc, gridId, userId, moduleId: kMod, targetId: kMod,
          parentId: sOcc, occurrences: [], fields: { ...(k.fields || {}) },
          identitySignature: k.identitySignature || null });
        kids.push(kOcc);
      }
      await Occurrence.create({ id: sOcc, gridId, userId, moduleId: sMod, targetId: sMod,
        parentId: rootOcc, occurrences: kids,
        identitySignature: s.identitySignature || null, fields: { ...(s.fields || {}) } });
      slotIds.push(sOcc);
    }
    await Occurrence.create({ id: rootOcc, gridId, userId, moduleId: rootMod, targetId: rootMod,
      parentId: stPage?.id ?? null, occurrences: slotIds,
      identitySignature: src.identitySignature || null, fields: { ...(src.fields || {}) } });
    if (stPage) await Occurrence.updateOne({ gridId, id: stPage.id }, { $push: { occurrences: rootOcc } });
    return rootOcc;
  };
  if (!day5Exists) await cloneRoot(day4, "Schedule - Day 5");

  // --- Day 4 gains the core work and the cardio routines --------------------
  const d4slots = new Map();
  for (const s of (day4.occurrences || []).map((i) => byId.get(i)).filter(Boolean)) {
    const t = s.fields?.[TS]?.value; if (t) d4slots.set(String(t), s);
  }
  const slot = d4slots.get(WORKOUT_SLOT);
  if (!slot) { log(`REFUSING: Day 4 has no ${WORKOUT_SLOT} slot.`); return; }
  const there = new Set((slot.occurrences || []).map((i) => nameOf(byId.get(i))));
  const place = [];
  for (const c of CORE_MOVEMENTS) {
    const src = coreSrc.get(norm(c));
    const sets = {};
    for (const n of ["Set 1", "Set 2", "Set 3", "Set 4"]) {
      const f = fid(n);
      if (f && src.fields?.[f]?.value != null) sets[f] = { ...src.fields[f] };
    }
    place.push({ src: exerciseSrc, label: "Exercise", sig: `cycle:${c}`,
      extra: { [MOV]: { value: [src.id], flow: "in" }, ...sets } });
  }
  for (const r of CARDIO_ROUTINES) {
    if (there.has(r)) continue;
    place.push({ src: catalog.get(r), label: r, sig: `cycle:${r}`, extra: {} });
  }
  const added = [];
  for (const p of place) {
    const srcMod = modById.get(p.src.moduleId);
    const nMod = randomUUID(), nOcc = randomUUID();
    await Module.create({ id: nMod, gridId, userId, label: p.label,
      role: srcMod?.role || "instance", fieldBindings: srcMod?.fieldBindings || [],
      meta: { ...(srcMod?.meta || {}) }, ownStyle: srcMod?.ownStyle || null,
      styleMode: srcMod?.styleMode || "inherit" });
    await Occurrence.create({ id: nOcc, gridId, userId, moduleId: nMod, targetId: nMod,
      parentId: slot.id, occurrences: [],
      fields: { ...(p.src.fields || {}), ...p.extra, [TS]: { value: WORKOUT_SLOT, flow: "in" } },
      identitySignature: p.sig, meta: { appliedFromTemplateId: p.src.id } });
    added.push(nOcc);
  }
  await Occurrence.updateOne({ gridId, id: slot.id }, { $push: { occurrences: { $each: added } } });
  await Module.updateOne({ gridId, id: day4.moduleId }, { $set: { label: "Schedule - Day 4" } });

  // --- the rotation now cycles over five ------------------------------------
  const after = await Occurrence.find({ gridId }).lean();
  const afterMods = await Module.find({ gridId }).lean();
  const tplByCycle = {};
  for (const n of NAMES) {
    const m = afterMods.find((x) => x.label === `Schedule - ${n}` && x.meta?.templateModule === true);
    const o = m ? after.find((x) => x.moduleId === m.id) : null;
    if (!o) { log(`REFUSING to rewire: "Schedule - ${n}" not found.`); return; }
    tplByCycle[n] = o.id;
  }
  const schedPage = after.find((o) => o.id === "llpF10Bda5nu");
  const marker = after.find((o) => nameOf(o) === MARKER_LABEL);
  const op = ops.find((o) => o.name === OP_NAME);
  if (schedPage && marker && op && CYCLE_FID) {
    const MEAL = fid("Meal");
    await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline: buildPipeline({
      schedPageOccId: schedPage.id, FMT, DATE, TS, MEAL, MOV,
      CYCLE_FID, markerOccId: marker.id, tplByCycle }) } });
    log(`rotation rewired over ${Object.keys(tplByCycle).length} templates.`);
  } else log(`REFUSING to rewire the rotation — a piece is missing.`);

  log(`stripped ${strip.length}, Day 4 gained ${added.length}, Day 5 ${day5Exists ? "kept" : "created"}.`);
}
