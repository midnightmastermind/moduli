// 0463 — Workout Log gets a CARDIO list (user, 2026-10-30: "the workouts list shouldnt have set1 weight1. make another
// list called cardio and use that"). 0461 put routines without movements (Run, Walk, Stretch …) into the Workouts
// table, under Set/Weight columns they never fill. Now they go to a new Cardio field (Exercise · Status · Duration ·
// Steps · Route · Time · Date), bound on the Workout Log tile beside Workouts; Workouts keeps the movement rows.
import { randomUUID } from "node:crypto";

export const id = "0463-workout-log-cardio-list";
export const describe = "Workout Log: routines without movements go to a new Cardio list (duration/steps/route), not Workouts.";
export const touches = ["operations", "fields", "modules"];

const TILE_MODULE = "bna6hkrwra";

/** Workout History (as 0461 left it) writing movement-less routines to $cardio. PURE. */
export function withCardioList(pipeline, { cardioFieldId, durationFieldId, stepsFieldId, routeFieldId }) {
  const p = JSON.parse(JSON.stringify(pipeline));
  const loop = p.steps.find((s) => s.type === "loop" && s.overExpr === "$allInstances" && s.as === "$inst");
  const gate = loop?.body?.find((s) => s.type === "if");
  const branch = gate?.then?.find((s) => s.id === "wl0461hasMv");
  const own = branch?.else?.find((s) => s.id === "wl0461own");
  if (!own) throw new Error("Workout History: 0461 shape not found");
  const v = own.config.value;
  own.config.name = "$cardio";
  own.config.value = {
    label: "$inst.label", status: "$status",
    duration: `$inst.fields.${durationFieldId}.value`, steps: `$inst.fields.${stepsFieldId}.value`, route: `$inst.fields.${routeFieldId}.value`,
    timeslot: v.timeslot, date: v.date,
  };
  const rowsInit = p.steps.findIndex((s) => s.config?.type === "INIT_VAR" && s.config.name === "$rows");
  if (rowsInit < 0) throw new Error("Workout History: no $rows init");
  p.steps.splice(rowsInit + 1, 0, { id: "wl0463init", type: "action", config: { type: "INIT_VAR", name: "$cardio", value: [] } });
  p.steps.push({ id: "wl0463write", type: "action", config: { type: "UPDATE", path: `$goalItem.fields.${cardioFieldId}.value`, value: "$cardio" } });
  return p;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation, Field, Module } = models;
  const op = await Operation.findOne({ gridId, name: "Workout History" }).lean();
  if (!op) throw new Error("no Workout History op");
  if (JSON.stringify(op.pipeline).includes("wl0463init")) { log("  already done"); return; }
  const byName = async (n) => (await Field.findOne({ gridId, name: n }).lean());
  const [workouts, dur, steps, route] = await Promise.all(["Workouts", "Duration", "Steps", "Route"].map(byName));
  if (!workouts || !dur || !steps || !route) throw new Error("a field is missing");
  let cardio = await Field.findOne({ gridId, name: "Cardio" }).lean();
  const cardioId = cardio?.id || randomUUID().replace(/-/g, "").slice(0, 12);
  const next = withCardioList(op.pipeline, { cardioFieldId: cardioId, durationFieldId: dur.id, stepsFieldId: steps.id, routeFieldId: route.id });
  log(`  Cardio field ${cardio ? "exists" : "new"} (${cardioId}); Workout History writes it`);
  if (dryRun) return;
  const now = new Date();
  if (!cardio) {
    await Field.create({ id: cardioId, userId: workouts.userId, gridId, name: "Cardio", type: "text", inputEnabled: false, displayEnabled: true,
      folderId: workouts.folderId, meta: {}, siblingLinks: [],
      displayConfig: { columns: [
        { path: "label", header: "Exercise" }, { path: "status", header: "Status" }, { path: "duration", header: "Duration" },
        { path: "steps", header: "Steps" }, { path: "route", header: "Route" }, { path: "timeslot", header: "Time" }, { path: "date", header: "Date" },
      ] } });
  }
  const mod = await Module.findOne({ gridId, id: TILE_MODULE }).lean();
  if (!(mod.fieldBindings || []).some((b) => b.fieldId === cardioId)) {
    const at = (mod.fieldBindings || []).findIndex((b) => b.fieldId === workouts.id);
    const binds = [...mod.fieldBindings];
    binds.splice(at + 1, 0, { fieldId: cardioId, order: 1, role: "display" });
    await Module.updateOne({ gridId, id: TILE_MODULE }, { $set: { fieldBindings: binds, updatedAt: now } });
  }
  await Operation.updateOne({ gridId, id: op.id }, { $set: { pipeline: next, updatedAt: now } });
  log("  applied. RESTART pm2.");
}
