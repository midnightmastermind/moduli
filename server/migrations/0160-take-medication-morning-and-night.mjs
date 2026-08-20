/**
 * 0160 — Take Medication lands twice a day, morning and night.
 *
 * USER, 2026-08-20, asked whether the new routine should sit in the catalog or on the schedule:
 * ***"Daily, but twice."***
 *
 * BOTH TIMES ARE LOOKUPS, NOT CONSTANTS — the rule `0110` set for Hot Tub ("the same timeslot as
 * hygiene is a lookup, not a constant"), applied to two anchors instead of one:
 *
 *     morning   the slot holding HYGIENE   — 7:30am today, 7:00am on a template with no workouts
 *     night     the slot holding JOURNAL   — the last filled slot of the day, 9:00pm
 *
 * Naming 7:30am and 9:00pm here would be correct today and wrong the first time either routine is
 * moved. Anchoring to Journal also means the night dose follows the wind-down rather than a clock.
 *
 * THE DROPDOWN IS LEFT EMPTY ON BOTH ROWS, deliberately. Which pills go in which dose is a medical
 * fact about this person's prescription, and the obvious inference — a stimulant in the morning, a
 * sedative at night — is exactly the kind of plausible-looking guess `0052` refused for phone
 * numbers and `0054` for addresses. The two rows are the SLOTS; the picks are one tap each and are
 * the user's to make.
 *
 * IT GOES ON ALL SIX TEMPLATES AND ON TODAY'S COLUMN.
 *   - `Day` is the one that MATTERS: `Schedule: Build Schedule` applies it every morning, so
 *     without it the routine would appear today and vanish tomorrow — the failure `0110` exists to
 *     have caught once already.
 *   - The five CYCLE templates get it too, because that is what Hygiene and Hot Tub look like on
 *     this grid and a template that is incomplete when applied by hand is a trap. It cannot
 *     double-place: `Schedule: Place Cycle Day` only places rows carrying a Meal or Movement PICK
 *     (`0112`), and this row carries neither.
 *   - TODAY'S COLUMN is written directly, by matching the `Time Slot` VALUE the way `0106` does,
 *     so the routine is on the schedule now rather than tomorrow.
 *
 * Idempotent per destination: a slot that already holds a "Take Medication" is skipped and logged,
 * so a re-run after a partial failure fills only the gaps.
 */
import { randomUUID } from "node:crypto";

export const id = "0160-take-medication-morning-and-night";
export const describe = "Place Take Medication in Hygiene's slot and Journal's slot on every day template and on today's column.";

export const ROUTINE = "Take Medication";
export const ANCHORS = ["Hygiene", "Journal"];

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map(m => [m.id, m]));
  const byId = new Map(occs.map(o => [o.id, o]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "?";
  const f = (n) => fields.find(x => x.name === n && !x.displayEnabled)?.id;
  const TS = f("Time Slot"), FMT = fields.find(x => x.name === "Schedule Format")?.id;
  const DATE = f("Date");
  if (!TS) { log("  REFUSING: no \"Time Slot\" field"); return; }

  // The routine to clone — from the CATALOG (Physical > Care), never a placement.
  const care = occs.find(o => nameOf(o) === "Care" && modById.get(o.moduleId)?.role === "container");
  const src = (care?.occurrences || []).map(i => byId.get(i)).find(o => nameOf(o) === ROUTINE);
  if (!src) { log(`  REFUSING: no "${ROUTINE}" routine under Physical > Care — run 0158 first`); return; }

  // ---- the destinations: the six templates, plus today's column -----------
  const stPage = occs.find(o => nameOf(o) === "Schedule Template");
  const templates = (stPage?.occurrences || []).map(i => byId.get(i)).filter(Boolean);
  const today = new Date();
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const isToday = (v) => typeof v === "string" ? v.slice(0, 10) === key(today) : false;
  const column = FMT ? occs.find(o => o.fields?.[FMT]?.value === "day-col" && isToday(o.fields?.[DATE]?.value)) : null;
  const destinations = [...templates, ...(column ? [column] : [])];
  if (!templates.length) { log("  REFUSING: no templates under \"Schedule Template\""); return; }
  log(`  destinations: ${templates.length} template(s)${column ? " + today's column" : " (no column for today — skipping it)"}`);

  // ---- resolve each anchor's slot, per destination ------------------------
  const plan = [];
  for (const dest of destinations) {
    for (const anchor of ANCHORS) {
      const slot = (dest.occurrences || []).map(i => byId.get(i))
        .find(s => (s?.occurrences || []).some(i => nameOf(byId.get(i)) === anchor));
      if (!slot) { log(`     ${nameOf(dest)} · ${anchor}: NOT PRESENT — skipped`); continue; }
      const already = (slot.occurrences || []).some(i => nameOf(byId.get(i)) === ROUTINE);
      log(`     ${nameOf(dest).padEnd(22)} ${anchor.padEnd(8)} ${String(slot.fields?.[TS]?.value ?? "?").padEnd(8)} ${already ? "already there" : "to place"}`);
      if (!already) plan.push({ dest, slot, anchor });
    }
  }
  if (!plan.length) { log("  already converged"); return; }
  if (dryRun) { log(`  (dry run — would place ${plan.length} row(s))`); return; }

  const srcMod = modById.get(src.moduleId);
  for (const { dest, slot } of plan) {
    const nMod = randomUUID(), nOcc = randomUUID();
    await Module.create({
      id: nMod, gridId, userId: src.userId, label: ROUTINE,
      role: srcMod?.role || "instance",
      fieldBindings: (srcMod?.fieldBindings || []).map(({ _id, ...b }) => b),
      meta: { ...(srcMod?.meta || {}) },
      ownStyle: srcMod?.ownStyle || null, styleMode: srcMod?.styleMode || "inherit",
    });
    await Occurrence.create({
      id: nOcc, gridId, userId: src.userId, moduleId: nMod,
      parentId: slot.id, occurrences: [],
      // The routine's own identity fields (Category, and Habit if it carries a
      // value) travel with it; the Time Slot is the destination's.
      fields: { ...(src.fields || {}), [TS]: { value: slot.fields?.[TS]?.value, flow: "in" } },
      meta: { appliedFromTemplateId: src.id },
    });
    await Occurrence.updateOne({ gridId, id: slot.id }, { $push: { occurrences: nOcc } });
    log(`  placed in "${nameOf(dest)}" at ${slot.fields?.[TS]?.value}`);
  }
  log("  done — RESTART pm2 and reload.");
}
