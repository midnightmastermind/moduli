// utils/migrationDelete.js
//
// Deleting an occurrence from a MIGRATION leaves its module behind.
//
// User, 2026-08-23: *"why do we keep having so many of them"*. Two causes, and
// this file addresses the second:
//
//   1. Placing a row CLONES its module (`cloneSubtree` mints one per node), so
//      the grid carries roughly one module per occurrence — `Eat` alone had 78
//      for one concept. That is the amplifier, and changing it is an
//      architectural pass, not this.
//   2. Removing a placement only sweeps the clone on the RUNTIME path
//      (`socketHandlers/crud.js`, `delete_occurrence`, fixed 2026-08-19). A
//      migration writes straight to Mongo, so that handler never runs.
//      Measured: **31 migrations delete occurrences and most never touch a
//      module.** `0108` alone stranded 56 `Eat` modules.
//
// So a migration that removes placements calls this instead of `deleteMany`.
//
// IT REUSES `planOrphanModules` — the same predicate the sweeper deletes by and
// the integrity rule reports by — rather than asking "is this module dead" a
// fourth way. Its refusals are the entire safety: a template ROOT is meant to
// have no placement, an op or textmap reference makes a module reachable, and a
// module minted moments ago may have a placement still in flight.
//
// TWO DELIBERATE DIFFERENCES FROM THE SWEEPER, both matching the runtime path:
//
//   minAgeMinutes: 0 — the age floor exists for a module whose FIRST placement
//   may still be in flight. Inside a migration the placement demonstrably
//   existed a moment ago, and the run is synchronous.
//
//   scope — only the modules THIS delete unplaced are considered. A migration
//   must never walk the whole module table and take unrelated debris with it;
//   that is `sweepOrphans`' job, with a human running it.
import { planOrphanModules, collectReferencedModuleIds } from "./orphanModules.js";

/**
 * Which of `moduleIds` are left unplaced by removing `deletedOccIds`.
 * PURE — the refusals are the risk, so they are testable without a database.
 */
export function modulesStrandedBy({ deletedOccIds, remainingOccurrences, modules, referencedIds = new Set() }) {
  const doomed = new Set(deletedOccIds || []);
  // SCOPED to the modules these occurrences were using. A migration must never
  // walk the whole module table and take unrelated debris with it — that is
  // `sweepOrphans`' job, with a human running it. Kept in the PURE function so
  // the property is testable, not in the wrapper where it cannot be asserted.
  const touched = new Set((remainingOccurrences || [])
    .filter((o) => doomed.has(o.id)).map((o) => o.moduleId).filter(Boolean));
  const candidates = (modules || []).filter((m) => m && touched.has(m.id));
  const { drop, keep } = planOrphanModules({
    modules: candidates,
    occurrences: (remainingOccurrences || []).filter((o) => !doomed.has(o.id)),
    referencedIds,
    minAgeMinutes: 0,
  });
  return { drop, keep };
}

/**
 * Delete occurrences and the modules they leave unplaced.
 * `textmaps` must be DECOMPRESSED by the caller — a textmap can embed a module,
 * and without them this would delete something a document still renders.
 */
export async function deleteOccurrencesAndStrandedModules({
  Occurrence, Module, gridId, occurrenceIds, allOccurrences, allModules, operations = [],
  textmaps = [], log = () => {}, dryRun = false,
}) {
  const ids = [...new Set(occurrenceIds || [])].filter(Boolean);
  if (!ids.length) { log("  nothing to delete"); return { occurrences: 0, modules: 0 }; }

  // `modulesStrandedBy` scopes to the touched modules itself; this narrows the
  // reference scan to the same set so it stays cheap on a big grid.
  const touchedIds = new Set((allOccurrences || [])
    .filter((o) => ids.includes(o.id)).map((o) => o.moduleId).filter(Boolean));
  const scoped = (allModules || []).filter((m) => touchedIds.has(m.id));
  const referencedIds = collectReferencedModuleIds(
    [...operations, ...textmaps], new Set(scoped.map((m) => m.id)));
  const { drop, keep } = modulesStrandedBy({
    deletedOccIds: ids, remainingOccurrences: allOccurrences, modules: scoped, referencedIds,
  });

  log(`  deleting ${ids.length} occurrence(s); ${drop.length} module(s) left unplaced by it`);
  for (const { mod, why } of keep) log(`    KEEPING module ${mod.label ?? mod.id} — ${why.join("; ")}`);
  if (dryRun) { log("  (dry run — nothing written)"); return { occurrences: ids.length, modules: drop.length }; }

  for (const id of ids) await Occurrence.deleteOne({ id, gridId });
  for (const m of drop) await Module.deleteOne({ id: m.id, gridId });
  return { occurrences: ids.length, modules: drop.length };
}
