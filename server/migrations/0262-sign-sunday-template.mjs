/**
 * 0262 — sign the Sunday template's nodes. A repair of my own `0261`.
 *
 * `0261` minted `Schedule: Workouts - Sunday` by cloning another template's 49
 * slots — and copied their FIELDS but not their `identitySignature`. The
 * integrity check caught it on the next run:
 *
 * ```
 * ❌ [unsigned-template-node] 49 occurrence(s) inside a template carry no
 *    identitySignature — a merge apply clones an unsigned node every time it runs
 * ```
 *
 * That rule exists (2026-07-31 (4)) because of the 23-duplicate-wrappers bug:
 * `APPLY_TEMPLATE mode:"merge"` decides "this already exists" by signature, so an
 * unsigned slot is never recognised and gets cloned into the day column on every
 * single load. Sunday would have grown a second set of 49 slots the first time
 * it was applied, then a third.
 *
 * **The scheme is READ from a template that already works, not restated** —
 * root `day-container`, each slot `slot:<its own label>`:
 *
 * ```
 * Monday: root sig="day-container"  slots 49  signed 49   "12:00am" -> "slot:12:00am"
 * Sunday: root sig=null             slots 49  signed  0
 * ```
 *
 * Forward-repair rather than an edit to `0261`, because `0261` has executed and
 * its ledger entry has to describe what ran (the 2026-08-07 (4) rule).
 */

export const id = "0262-sign-sunday-template";
export const describe =
  "Signs the identitySignature on the Sunday template minted by 0261 — root and all 49 slots — copying the scheme from a template that already has them. Without it a merge apply clones the slots on every run.";
export const touches = ["occurrences"];

/** Pure. What each node's signature should be, taken from a working exemplar. */
export function planSignatures({ occurrences, modules, folders }) {
  const refusals = [];
  const modById = new Map(modules.map((m) => [m.id, m]));
  const occById = new Map(occurrences.map((o) => [o.id, o]));
  const labelOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "";

  // MIRRORS `utils/gridIntegrity.js` exactly — a template is identified by
  // LOCATION (a child of the protected "Templates" folder) or by being named as
  // someone's `appliedFromTemplateId`. The `meta.templateModule` marker is NOT
  // used: 0035 unsets it on template roots while leaving it on nested nodes, so
  // it points at exactly the wrong occurrences. Deriving the target set from a
  // different rule than the checker would let this migration "pass" while the
  // error stayed.
  const templateFolderIds = new Set(
    (folders || []).filter((f) => f?.meta?.protected && f.name === "Templates").map((f) => f.id),
  );
  const roots = new Set();
  for (const o of occurrences) {
    if (o.meta?.appliedFromTemplateId) roots.add(o.meta.appliedFromTemplateId);
    if (o.parentId && templateFolderIds.has(o.parentId)) roots.add(o.id);
  }
  if (!roots.size) { refusals.push("no template root found (no protected Templates folder?)"); return { refusals }; }

  // Walk each root the way the checker does and collect unsigned CONTAINERS,
  // remembering which root each came from so a signature can be copied from a
  // signed sibling under the SAME root.
  const unsigned = [];
  const signedByLabel = new Map();
  for (const rootId of roots) {
    const root = occById.get(rootId);
    if (!root) continue;
    const rootIsWrapperPage = modById.get(root.moduleId)?.role === "page";
    const exempt = rootIsWrapperPage ? new Set(root.occurrences || []) : new Set();
    const seen = new Set([rootId]);
    const walk = (id) => {
      const o = occById.get(id);
      if (!o) return;
      if (modById.get(o.moduleId)?.role === "container" && !exempt.has(o.id)) {
        if (o.identitySignature) signedByLabel.set(labelOf(o), o.identitySignature);
        else unsigned.push({ id: o.id, label: labelOf(o), parentId: o.parentId });
      }
      for (const c of o.occurrences || []) if (!seen.has(c)) { seen.add(c); walk(c); }
    };
    for (const c of root.occurrences || []) if (!seen.has(c)) { seen.add(c); walk(c); }
  }
  if (!unsigned.length) return { refusals, targets: [], prefix: null };

  // The scheme, READ from a signed sibling rather than restated.
  const sample = [...signedByLabel.values()][0];
  const prefix = sample ? String(sample).split(":")[0] : null;
  if (!prefix) { refusals.push("no signed sibling to copy a `<prefix>:<label>` scheme from"); return { refusals }; }

  const targets = unsigned.map((u) => ({
    id: u.id, label: u.label,
    // Prefer the EXACT signature a sibling of the same name already uses.
    sig: signedByLabel.get(u.label) || `${prefix}:${u.label}`,
    copied: signedByLabel.has(u.label),
  }));
  return { refusals, prefix, targets };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Folder } = models;
  const [occurrences, modules, folders] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Folder.find({ gridId }).lean(),
  ]);
  const p = planSignatures({ occurrences, modules, folders });
  if (p.refusals.length) { for (const r of p.refusals) log(`  REFUSING — ${r}`); return; }
  if (!p.targets.length) { log("every template container is signed — nothing to do."); return; }

  const copied = p.targets.filter((t) => t.copied).length;
  log(`${p.targets.length} unsigned template container(s); scheme "${p.prefix}:<label>"`);
  log(`  ${copied} take the EXACT signature a same-named sibling already uses; ${p.targets.length - copied} are built from the scheme`);
  for (const t of p.targets.slice(0, 6)) log(`   "${t.label}" -> "${t.sig}"${t.copied ? "  (copied)" : ""}`);
  if (p.targets.length > 6) log(`   … and ${p.targets.length - 6} more`);
  if (dryRun) { log("DRY RUN — nothing written."); return; }

  for (const t of p.targets) await Occurrence.updateOne({ gridId, id: t.id }, { $set: { identitySignature: t.sig } });
  log(`\nsigned ${p.targets.length} container(s)`);
}
