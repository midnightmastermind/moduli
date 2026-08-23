// 0211 — 202 of the 216 modules that can be COMPLETED had nowhere to record WHEN.
//
// `0210` fixed `Schedule: Stamp Completed On` so it finally writes. This gives it
// something to write to almost everywhere, because the stamp only lands where the
// module BINDS the field:
//
//     modules binding `Completed`        216
//     modules binding `Completed On`      14
//     the gap                            202
//
// Without this, a windowed `Completed` feed — the thing the user is actually
// asking for (*"why is complete in the schedule under tasks, something i
// completed days ago"*) — would hide nearly everything rather than just the old
// ones, which is a worse answer than the complaint.
//
// **IT CHANGES NOTHING ON SCREEN, and that is checked rather than hoped.** All 14
// existing bindings are `role: "input", hidden: true`, and the field itself is
// `inputEnabled: false, displayEnabled: false` — pure metadata. This copies that
// shape exactly, so 202 rows gain a recording slot and not a pill.
//
// STRUCTURAL: "binds Completed, does not bind Completed On". No list of names, so
// a module added next month is covered by a re-run.
//
// It REUSES `0208`'s `planBindingAppend` rather than restating it. Two migrations
// appending a binding two different ways is exactly the twin this repo keeps
// paying for; the helper grew an options argument whose defaults leave `0208`
// byte-identical.
import { planBindingAppend } from "./0208-bills-can-be-ticked.mjs";

export const id = "0211-anything-completable-records-when";
export const description =
  "Bind `Completed On` (hidden) wherever `Completed` is bound — 202 modules could be completed with nowhere to record when";

export async function up({ gridId, models, log, dryRun }) {
  const { Field, Module } = models;
  const completed = await Field.findOne({ gridId, name: "Completed", type: "boolean" }).lean();
  const completedOn = await Field.findOne({ gridId, name: "Completed On", type: "date" }).lean();
  if (!completed || !completedOn) {
    log(`  missing field — Completed:${!!completed} Completed On:${!!completedOn} — REFUSING`);
    return { bound: 0, refused: true };
  }

  const mods = await Module.find({ gridId }).lean();
  const binds = (m, fid) => (m.fieldBindings || []).some((b) => b?.fieldId === fid);
  const targets = mods.filter((m) => binds(m, completed.id) && !binds(m, completedOn.id));
  log(`  ${mods.filter((m) => binds(m, completed.id)).length} module(s) bind Completed; ${targets.length} lack Completed On`);

  const ops = [];
  for (const m of targets) {
    // HIDDEN — the same shape the 14 existing bindings use. A visible date pill
    // on 202 rows would be a change nobody asked for.
    const next = planBindingAppend(m.fieldBindings, completedOn.id, { role: "input", hidden: true });
    if (!next) continue;
    ops.push({ updateOne: { filter: { id: m.id, gridId }, update: { $set: { fieldBindings: next } } } });
  }
  for (const m of targets.slice(0, 5)) log(`    ${(m.label || "?").slice(0, 30)}`);
  if (targets.length > 5) log(`    … ${targets.length - 5} more`);

  log(`${dryRun ? "[dry run] " : ""}${ops.length} module(s) gain a hidden Completed On binding`);
  if (!dryRun && ops.length) await Module.bulkWrite(ops, { ordered: false });
  return { bound: ops.length };
}
