// 0440 — the Day Page's own date arrows import the readings again (user, 2026-10-26: "i just did tomorrows daypage and
// nothing popped up for reflections"). "Day Page: Readings" copied Day Page: Build's gate — run when the change came
// from nowhere in particular (the toolbar, a load) OR from the Day Page (`$trigger.sourceOccurrenceId IS $board.id`)
// — but not the INIT_VAR that sets $board, so the second arm compared against nothing and a date change on the Day
// Page itself ran nothing. The INIT_VARs the gate reads are copied from Build, right after $readings.
import { gateInits } from "./0402-day-page-readings.mjs";

export const id = "0440-readings-gate-board";
export const describe = "Gives 'Day Page: Readings' the $board variable its gate reads (copied from Day Page: Build), so the Day Page's own date arrows import the day's readings.";
export const touches = ["operations"];

/** The caller's steps with the gate's missing variables inserted after $readings. Pure. */
export function withGateVars(callerSteps, buildSteps) {
  const gate = (callerSteps || []).find((s) => s.type === "if")?.condition;
  const have = new Set((callerSteps || []).map((s) => s?.config?.type === "INIT_VAR" && s.config.name).filter(Boolean));
  const missing = gateInits(buildSteps, gate).filter((s) => !have.has(s.config.name));
  if (!missing.length) return null;
  const at = Math.max(0, callerSteps.findIndex((s) => s?.config?.name === "$readings")) + 1;
  return [...callerSteps.slice(0, at), ...missing.map((s) => ({ ...s, id: `${s.id}-r` })), ...callerSteps.slice(at)];
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const caller = await Operation.findOne({ gridId, name: "Day Page: Readings" }).lean();
  const build = await Operation.findOne({ gridId, name: "Day Page: Build" }).lean();
  if (!caller || !build) throw new Error("missing Day Page: Readings or Day Page: Build");
  const next = withGateVars(caller.pipeline.steps, build.pipeline.steps);
  if (!next) { log("  nothing to add"); return; }
  log(`  add ${next.length - caller.pipeline.steps.length} step(s): ${next.filter((s) => !caller.pipeline.steps.includes(s)).map((s) => `${s.config.name} = ${s.config.expr}`).join(", ")}`);
  if (dryRun) return;
  await Operation.updateOne({ gridId, id: caller.id }, { $set: { "pipeline.steps": next, updatedAt: new Date() } });
  log("  applied. RESTART pm2.");
}
