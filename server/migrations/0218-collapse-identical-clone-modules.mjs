// 0218 — 831 modules that are byte-identical copies of one another become 184.
//
// User, 2026-08-23: *"shouldnt the module too be one, isnt that what the premise
// of the site is."* `cd8c449f` stopped APPLY_TEMPLATE minting a fresh module per
// apply; this collapses what it already minted.
//
// ── THE FINGERPRINT IS THE WHOLE SAFETY ARGUMENT ───────────────────────────
//
// Two modules are merged only when they are IDENTICAL on everything an
// occurrence can observe: label, role, kind, `ownStyle`, and the full
// `fieldBindings` list (fieldId + role + hidden + order). Anything that differs
// means they are not interchangeable, and 93 modules on this grid share a
// label+role+kind while differing somewhere — those are LEFT ALONE, and finding
// them is the reason the predicate is a fingerprint rather than a name.
//
// Three meta keys are excluded from the fingerprint because they record where a
// module CAME FROM rather than what it is: `clonedFromModuleId`,
// `appliedFromTemplateId`, `templateName`.
//
//     repeatable singleton modules              3364
//       byte-identical groups                    184  -> 831 modules
//       collapse to                              184  -> saves 647
//       same name, NOT identical                  93  -> untouched
//
// ── IT ONLY REPOINTS. IT DELETES NOTHING ───────────────────────────────────
//
// After the repoint the losing modules place no occurrence, which makes them
// ordinary orphans — and `sweepOrphans` already knows how to remove those, with
// a dump, an age floor, and a refusal for anything an operation or textmap still
// names. Deleting them here would be a second, worse copy of that judgement.
// So this migration has one job and the existing sweeper finishes it.
//
// ── AND A MODULE ANYTHING ELSE NAMES IS NOT MERGED AWAY ────────────────────
//
// An operation or a textmap can name a module id. Repointing an occurrence off
// such a module would leave that reference pointing at something no longer
// placed. The scan is `orphanModules.collectReferencedModuleIds` — the SAME one
// the sweeper uses, so the two cannot disagree about what "referenced" means.
import { collectReferencedModuleIds } from "../utils/orphanModules.js";
import { decompressTextmap } from "../utils/textmapCompression.js";
import Grid from "../models/Grid.js";

export const id = "0218-collapse-identical-clone-modules";
export const description =
  "831 byte-identical clone modules become 184 — one module, many occurrences";

/** Everything an occurrence can observe about its module. PURE. */
export function moduleFingerprint(m) {
  const meta = Object.fromEntries(
    Object.entries(m?.meta || {})
      .filter(([k]) => !["clonedFromModuleId", "appliedFromTemplateId", "templateName"].includes(k))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return JSON.stringify({
    label: m?.label ?? m?.name ?? null,
    role: m?.role ?? null,
    kind: m?.kind ?? null,
    ownStyle: m?.ownStyle || null,
    bindings: (m?.fieldBindings || [])
      .map((b) => [b?.fieldId ?? null, b?.role ?? null, !!b?.hidden, b?.order ?? null])
      .sort((a, b) => String(a).localeCompare(String(b))),
    meta,
  });
}

/**
 * Which modules can share one. PURE, so the whole decision is testable.
 * @returns [{ keeper, losers: [] }]
 */
export function planCollapse({ modules, occurrenceCountByModule, referencedIds = new Set() }) {
  const groups = new Map();
  for (const m of modules) {
    if (!m?.id) continue;
    // Only modules placed EXACTLY ONCE. A shared module is already doing the
    // right thing, and a placed-nowhere one is the sweeper's business.
    if ((occurrenceCountByModule.get(m.id) || 0) !== 1) continue;
    // Genuinely unique content: a bookmark's URL lives in `fileRef`, an
    // unlabelled textblock's text lives on its occurrence. Those are SUPPOSED
    // to be 1:1 and merging them would merge unrelated things.
    if (m.fileRef) continue;
    if (m.role === "textblock" && !m.label) continue;
    if (m.meta?.templateModule === true) continue;    // a template is not a placement
    if (m.trashed) continue;
    const k = moduleFingerprint(m);
    (groups.get(k) || groups.set(k, []).get(k)).push(m);
  }
  const out = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    // Deterministic keeper: the oldest, falling back to the lowest id, so a
    // re-run picks the same one and the migration converges.
    const sorted = [...list].sort((a, b) =>
      String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || String(a.id).localeCompare(String(b.id)));
    const keeper = sorted[0];
    const losers = sorted.slice(1).filter((m) => !referencedIds.has(m.id));
    if (losers.length) out.push({ keeper, losers });
  }
  return out;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Module, Occurrence, Operation } = models;
  const mods = await Module.find({ gridId }).lean();
  const occs = await Occurrence.find({ gridId }).lean();
  const ops = await Operation.find({ gridId }).lean();

  const count = new Map();
  for (const o of occs) count.set(o.moduleId, (count.get(o.moduleId) || 0) + 1);

  // The SAME scan the sweeper uses — and over the SAME inputs, which is the
  // part that matters. Handing it whole occurrences instead of their DECOMPRESSED
  // TEXTMAPS made every module "referenced" by its own occurrence's `moduleId`
  // field: 6,927 of 6,929 on the first run. A hit rate that high is a claim about
  // the probe, not about the data.
  const candidates = new Set(mods.map((m) => m.id));
  const textmaps = occs.map((o) => decompressTextmap(o.textmap)).filter(Boolean);
  const gridMetaDocs = await Grid.find({ _id: gridId }).select({ meta: 1 }).lean();
  const referenced = collectReferencedModuleIds([...ops, ...textmaps, ...gridMetaDocs], candidates);
  log(`  ${referenced.size} module id(s) are named by an operation or a textmap — those are never merged away`);

  const plan = planCollapse({ modules: mods, occurrenceCountByModule: count, referencedIds: referenced });
  const totalLosers = plan.reduce((a, g) => a + g.losers.length, 0);
  const byLabel = [...plan].sort((a, b) => b.losers.length - a.losers.length).slice(0, 8);
  for (const g of byLabel) {
    log(`    ${String(g.losers.length + 1).padStart(3)} x  ${(g.keeper.label || "(no label)").slice(0, 26).padEnd(28)} ${g.keeper.role}/${g.keeper.kind || "-"}`);
  }
  log(`${dryRun ? "[dry run] " : ""}${plan.length} group(s); ${totalLosers} occurrence(s) repointed onto ${plan.length} keeper module(s)`);

  if (!dryRun && totalLosers) {
    const ops2 = [];
    for (const g of plan) {
      for (const loser of g.losers) {
        // Repoint by MODULE, not by a precomputed occurrence list: the loser is
        // placed exactly once by construction, and matching on moduleId cannot
        // touch anything else.
        ops2.push({ updateMany: { filter: { gridId, moduleId: loser.id },
                                  update: { $set: { moduleId: g.keeper.id, targetId: g.keeper.id } } } });
      }
    }
    await Occurrence.bulkWrite(ops2, { ordered: false });
  }
  // The losers now place nothing. `sweepOrphans` removes them with its own dump,
  // age floor and refusals — this migration deliberately deletes nothing.
  return { groups: plan.length, repointed: totalLosers };
}
