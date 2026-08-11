// server/migrations/0076-clear-inert-kind-recurrence.mjs
//
// User, 2026-08-11: *"i thought we settled a kind vs role thing"*. They had —
// `0003` cleared 525 of these on 2026-07-29. This clears the 232 that came
// back, now that the thing minting them is fixed.
//
// ── WHY IT RECURRED, WHICH IS THE PART WORTH READING ───────────────────────
//
// `kind` is the sub-type WITHIN a role. Only container / page / artifact /
// textblock have one. On an instance it means nothing — except that
// `getModuleTypeIcon` resolves kind BEFORE role, so an `instance/doc` draws the
// DOC icon everywhere an icon appears.
//
// The 2026-07-29 removal fixed the CREATE action. It did not fix the effect
// APPLIER: `bindSocketToStore`'s CREATE_ITEM branch had its own independent
// `kind: effect.template.kind || "doc"`. A CLONE copies `kind: srcMod.kind`
// faithfully, so cloning a KINDLESS template emitted `undefined` — and the
// applier turned it into a kind. Two copies of one decision, one of them
// fixed. Both call a single exported `kindForNewModule` now.
//
// The census is what identified it, and nothing else would have:
//   232 stray, ALL role:"instance" kind:"doc", ALL carrying
//   appliedFromTemplateId, 2026-08-02 .. 08-11, ~6-12/day (the Schedule's
//   daily routine clones: Drink / Hygiene / Eat / Walk / Exercise / Journal)
//   -- while every one of their TEMPLATES is `instance/-`, i.e. clean.
// A clean source producing dirty clones is what pointed past the clone code at
// the layer underneath it.
//
// ── SCOPE: IDENTICAL TO 0003, DELIBERATELY ────────────────────────────────
//
// Only instance- and panel-role modules, and only the `kind` key. It writes no
// occurrence, no field, no operation. There is no selector here that can match
// the wrong thing — the role IS the predicate.

export const id = "0076-clear-inert-kind-recurrence";
export const describe =
  "Unsets `kind` on instance- and panel-role modules again (232 on poms grid, "
  + "minted by the clone path between 2026-08-02 and 08-11). Same scope as 0003; "
  + "the applier that re-created them is fixed in the same pass.";

// Imported, never restated — `gridIntegrity` is the rule that REPORTS this
// class, so a migration that clears it must agree with it by construction.
import { KIND_BEARING_ROLES } from "../utils/gridIntegrity.js";

export const KIND_BEARING = [...KIND_BEARING_ROLES];
export const KINDLESS_ROLES = ["instance", "panel"];

export async function up({ gridId, models, log, dryRun }) {
  const { Module } = models;

  const doomed = await Module.find({
    gridId, role: { $in: KINDLESS_ROLES }, kind: { $ne: null },
  }).select({ id: 1, role: 1, kind: 1, label: 1, createdAt: 1 }).lean();

  if (!doomed.length) { log("no instance/panel module carries a kind — nothing to do"); return; }

  const byKind = {};
  for (const m of doomed) byKind[`${m.role}/${m.kind}`] = (byKind[`${m.role}/${m.kind}`] || 0) + 1;
  log(`${doomed.length} module(s): ${Object.entries(byKind).map(([k, n]) => `${k}×${n}`).join(", ")}`);

  // Report the DATE SPREAD, not just a count. 0003 cleared this class once; if
  // it is back, when it started is the only thing that says whether the source
  // fix landed — a single old cluster means fixed, a run up to today means not.
  const stamps = doomed
    .map(m => m.createdAt && new Date(m.createdAt))
    .filter(Boolean).sort((a, b) => a - b);
  if (stamps.length) {
    log(`minted ${stamps[0].toISOString().slice(0, 10)} .. ${stamps[stamps.length - 1].toISOString().slice(0, 10)}`);
  }
  log(`sample: ${doomed.slice(0, 6).map(m => JSON.stringify(m.label || m.id)).join(", ")}`);

  // The kind-bearing roles must be untouched by this filter — stated as a
  // measurement rather than trusted, since it is the one way to be wrong here.
  const bearing = await Module.countDocuments({ gridId, role: { $in: KIND_BEARING }, kind: { $ne: null } });
  log(`leaving ${bearing} container/page/artifact/textblock module(s) with their kind intact`);

  if (dryRun) { log("DRY RUN — would unset kind on the listed modules"); return; }

  const { modifiedCount } = await Module.updateMany(
    { gridId, role: { $in: KINDLESS_ROLES }, kind: { $ne: null } },
    { $unset: { kind: "" } },
  );
  log(`✓ cleared kind on ${modifiedCount} module(s); the icon resolver now falls through to role`);
}
