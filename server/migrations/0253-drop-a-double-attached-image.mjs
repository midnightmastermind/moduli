/**
 * 0253 — the same picture attached to one row TWICE, as two artifacts.
 *
 * User, 2026-08-25, after the movie-poster duplication was fixed: "yes i want
 * those fixed" — of two things reported alongside it. This is the half that
 * turned out to be real.
 *
 * ── WHAT IS ACTUALLY WRONG, MEASURED ─────────────────────────────────────
 *
 * Two ingredient rows hold FOUR image artifacts each, and in both cases two of
 * those four resolve to the identical fileRef:
 *
 *   Hummus          ed534534  Aug 13  …/Recipe-Homemade-Hummus.jpg   <- the Poster
 *                   63fc5875  Aug 16  …/Recipe-Homemade-Hummus.jpg   <- redundant
 *   Protein Powder  81d4c1a2  Aug 13  …/…c448c5.jpeg                 <- the Poster
 *                   19a167c5  Aug 16  …/…c448c5.jpeg                 <- redundant
 *
 * The Aug 13 entry is the one each row PICKED as its `role:"media"` face; the
 * Aug 16 twin came from a later attach pass that did not check whether that
 * url was already on the row. Nothing else on the grid repeats a file this
 * way — the scan found these two and no others.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────
 *
 * IT DOES NOT DEDUPE MEDIA ROWS BY LABEL. The same scan reported "518 groups /
 * 663 extra rows" of media sharing a title, and reading them is what killed
 * that idea: `Hellboy (2004)` and `Hellboy (2019)` are different films,
 * `Cosmos` and `Cosmos (2014)` are different series, and eight different
 * albums are called `Greatest Hits`. Deleting on a label match is the `0035`
 * mistake — and it is why the media import kept the YEAR in the match key
 * while stripping it from the title (2026-08-25 (2): "there the year is
 * identity"). The two `John Wick` rows are one film in two files (45.0 GB and
 * 29.2 GB, different paths), which is a real thing to own; left alone.
 *
 * IT DOES NOT TOUCH THE RESOLVER. `filesOf` deliberately does not collapse two
 * artifacts that share a url — that would HIDE a double-attach rather than fix
 * one, which is exactly the case here. The data is what is wrong.
 *
 * ── THE GUARD ────────────────────────────────────────────────────────────
 *
 * A twin is removed only when every one of these holds:
 *   - it is role:"artifact" with a non-empty fileRef;
 *   - ANOTHER artifact on the SAME owner has the identical fileRef;
 *   - it is NOT the owner's media/primary pick (the keeper always is);
 *   - it is older-or-equal to nothing... rather, it is the LATER of the two;
 *   - it carries no children and no textmap of its own;
 *   - no OTHER occurrence outside this owner references it.
 * Anything failing one of those is reported and left.
 */

export const id = "0253-drop-a-double-attached-image";
export const touches = ["occurrences", "modules"];

const unwrap = (v) =>
  v && typeof v === "object" && !Array.isArray(v) && "value" in v ? v.value : v;

const idsFrom = (v) =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string" && x)
    : typeof v === "string" && v ? [v] : [];

export function planDoubleAttachments({ occurrences, modules }) {
  const modById = Object.fromEntries(modules.map((m) => [m.id, m]));
  const occById = Object.fromEntries(occurrences.map((o) => [o.id, o]));
  const artifactOf = (id) => {
    const o = occById[id]; const m = o && modById[o.moduleId];
    return m && m.role === "artifact" && m.fileRef ? { occ: o, mod: m } : null;
  };

  const plans = new Map();                 // removeId -> plan (one per artifact)
  for (const owner of occurrences) {
    const mod = modById[owner.moduleId];
    if (!mod) continue;
    // A FEED COPY IS NOT AN OWNER. feedSync re-mints its children on every
    // sync, so both the duplicate it lists and any repair written to it are
    // transient — deciding from a copy would plan work against something about
    // to be overwritten (2026-08-10).
    if (owner.meta?.feedSourceId) continue;
    const binds = Array.isArray(mod.fieldBindings) ? mod.fieldBindings : [];
    const mediaFid = binds.find((b) => b?.role === "media")?.fieldId || null;
    const filesFid = binds.find((b) => b?.role === "files")?.fieldId || null;
    const primaryId = idsFrom(unwrap(owner.fields?.[mediaFid]))[0] || null;
    const fileIds = idsFrom(unwrap(owner.fields?.[filesFid]));
    const childIds = Array.isArray(owner.occurrences) ? owner.occurrences : [];

    const byRef = new Map();
    for (const id of [...new Set([...fileIds, ...childIds])]) {
      const a = artifactOf(id);
      if (!a) continue;
      if (!byRef.has(a.mod.fileRef)) byRef.set(a.mod.fileRef, []);
      byRef.get(a.mod.fileRef).push(a);
    }

    for (const [ref, group] of byRef) {
      if (group.length < 2) continue;
      const sorted = [...group].sort(
        (x, y) => new Date(x.occ.createdAt || 0) - new Date(y.occ.createdAt || 0));
      const keeper = group.find((g) => g.occ.id === primaryId) || sorted[0];
      for (const t of group) {
        if (t.occ.id === keeper.occ.id) continue;
        if (plans.has(t.occ.id)) continue;
        const reasons = [];
        if (t.occ.id === primaryId) reasons.push("it IS the primary pick");
        if ((t.occ.occurrences || []).length) reasons.push("it has children");
        if (t.occ.textmap) reasons.push("it carries a textmap");

        // Every occurrence that names this artifact anywhere. The ones that do
        // NOT block are: this owner, this owner's own `<label> — files`
        // container, and any feed COPY (a regenerated view of one of those).
        const holders = occurrences.filter(
          (o) => o.id !== t.occ.id &&
            ((o.occurrences || []).includes(t.occ.id) ||
             JSON.stringify(o.fields || {}).includes(t.occ.id)));
        const ownFiles = `${owner.label || mod.label} — files`;
        const foreign = holders.filter((o) =>
          o.id !== owner.id &&
          !o.meta?.feedSourceId &&
          (o.label || modById[o.moduleId]?.label || "") !== ownFiles);
        if (foreign.length) {
          reasons.push(`referenced by ${foreign.length} unrelated occurrence(s)`);
        }
        plans.set(t.occ.id, {
          ownerId: owner.id, ownerLabel: owner.label || mod.label,
          removeId: t.occ.id, keepId: keeper.occ.id, ref,
          alsoListedBy: holders.map((o) => o.id),
          refuse: reasons.length ? reasons.join("; ") : null,
        });
      }
    }
  }
  return [...plans.values()];
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const [occurrences, modules] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
  ]);
  const plans = planDoubleAttachments({ occurrences, modules });
  if (!plans.length) { log("no row attaches one file twice — nothing to do."); return; }

  const modById = Object.fromEntries(modules.map((m) => [m.id, m]));
  let removed = 0;
  for (const p of plans) {
    if (p.refuse) { log(`  SKIP "${p.ownerLabel}" ${p.removeId.slice(0, 8)} — ${p.refuse}`); continue; }
    log(`  "${p.ownerLabel}": drop ${p.removeId.slice(0, 8)}, keep ${p.keepId.slice(0, 8)}  (${p.ref.slice(-38)})`);
    removed++;
    if (dryRun) continue;

    // ATOMIC $pull, NEVER A WHOLE-ARRAY $set.
    //
    // The user is on the grid while this runs, and a connected tab echoes back
    // whatever `occurrences[]` its last full_state gave it — which is how a
    // migration's array write got silently reverted on 2026-08-13 (2). `$pull`
    // removes one element server-side and cannot carry a stale snapshot.
    for (const holderId of [p.ownerId, ...p.alsoListedBy]) {
      const holder = await Occurrence.findOne({ gridId, id: holderId }).lean();
      if (!holder) continue;
      const filesFid = (modById[holder.moduleId]?.fieldBindings || [])
        .find((b) => b?.role === "files")?.fieldId;
      const pull = {};
      if (filesFid) {
        const raw = holder.fields?.[filesFid];
        const wrapped = raw && typeof raw === "object" && !Array.isArray(raw) && "value" in raw;
        pull[wrapped ? `fields.${filesFid}.value` : `fields.${filesFid}`] = p.removeId;
      }
      if ((holder.occurrences || []).includes(p.removeId)) pull.occurrences = p.removeId;
      if (Object.keys(pull).length) {
        await Occurrence.updateOne({ gridId, id: holderId }, { $pull: pull });
      }
    }
    const doomed = await Occurrence.findOne({ gridId, id: p.removeId }).lean();
    await Occurrence.deleteOne({ gridId, id: p.removeId });
    if (doomed?.moduleId) {
      const stillPlaced = await Occurrence.countDocuments({ gridId, moduleId: doomed.moduleId });
      if (stillPlaced === 0) await Module.deleteOne({ gridId, id: doomed.moduleId });
    }
  }
  log(`\nplan: ${removed} redundant attachment(s) removed, ${plans.length - removed} refused`);
  if (dryRun) log("DRY RUN — nothing written.");
}
