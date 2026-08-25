/**
 * 0246 — the poster becomes a real FILE the row owns, and the row can hold more.
 *
 * User, 2026-08-25, after the TMDB covers landed: *"make it have the fileRef"*
 * and *"it should able to hold multiple files"*.
 *
 * ── `fileRef` CANNOT GO ON THE ROW, AND THAT IS THE WHOLE REASON THIS EXISTS ─
 *
 * `fileRef` lives on the MODULE. `0238` mints ONE SHARED module per kind —
 * measured: 993 movie occurrences, **`movie: 1` module** — so writing the
 * poster there gives all 993 films the same picture. The same trap `0245` hit
 * with `meta.cover`, one level down.
 *
 * So the poster becomes its OWN artifact: a module with a real `fileRef` and an
 * occurrence of it, parented to the row AND listed in the row's
 * `occurrences[]`. That gives both halves of the ask at once — a genuine
 * fileRef, and a row that holds N files rather than one.
 *
 * ── WHY A CHILD, AND NOT THE `Files` FIELD ───────────────────────────────
 *
 * `occurrenceMedia.filesOf` collects from THREE sources — the media field, the
 * `Files` field, and `occ.occurrences`. The child list needs no field, no
 * binding and no `role:"files"` plumbing on a shared module, and it is already
 * how `0061` attached a favicon to a bookmark:
 *
 *   > the favicon is parented to the bookmark AND listed in its `occurrences[]`
 *   > … An instance does not render its children, so it stays out of the row
 *   > while appearing in the bookmark's own file spread.
 *
 * Both halves matter and both are done here. The delete cascade walks the child
 * LIST, so a poster that is only PARENTED is orphaned the moment the row goes;
 * and a child that is only LISTED has no home. Adding a second poster later is
 * one more child — nothing about this shape is single-file.
 *
 * ── THE CARD FACE IS UNCHANGED, DELIBERATELY ─────────────────────────────
 *
 * `meta.cover` still draws the thumbnail and is left in place. `primaryMediaOf`
 * reads the media-role BINDING, not children, so removing the cover here would
 * blank 1,172 cards to buy nothing. The cover is the face; the child is the
 * file. Two questions, two answers — the split `ArtifactCard` already documents.
 *
 * ── SCOPE, MEASURED ──────────────────────────────────────────────────────
 *
 * Only rows that HAVE a cover and do NOT already have an artifact child. So it
 * is resumable, it is a no-op on a second pass, and the 8 titles TMDB could not
 * match are skipped rather than given an empty file.
 *
 * The poster artifacts are homed under the row itself rather than in
 * `Files/Images`: they are not files the user uploaded and filed, they are
 * fetched artwork belonging to one row, and putting 1,172 of them in the
 * Images folder would bury the 223 real uploads that live there.
 */
const uid = () => Math.random().toString(36).slice(2, 14);

export const id = "0246-poster-artifacts";
export const describe =
  "Turns each movie/TV cover into its own image artifact (a real fileRef), parented to and listed by the row, so a row owns its poster and can hold more files.";
export const touches = ["occurrences", "modules"];

export const KINDS = ["movie", "series"];

/**
 * Which rows need a poster artifact — the whole selection rule, pure so it can
 * be tested without a database. Returns the plan, never writes.
 *
 * A row qualifies only when it HAS a cover and does NOT already own an artifact
 * child. Both halves matter: the first skips the titles TMDB never matched
 * rather than attaching an empty file, the second is what makes the migration
 * resumable and a re-run a no-op.
 */
export function planPosterArtifacts({ occs, modById }) {
  const isArtifactModule = (mid) => modById.get(mid)?.role === "artifact";

  // Rows that already own an artifact child, counted from `parentId` — the
  // child's HOME, which is what a second run would otherwise duplicate.
  const childArtifactCount = new Map();
  for (const o of occs) {
    if (!o.parentId) continue;
    if (!isArtifactModule(o.moduleId)) continue;
    childArtifactCount.set(o.parentId, (childArtifactCount.get(o.parentId) || 0) + 1);
  }

  const targets = [];
  let noCover = 0;
  let already = 0;
  for (const o of occs) {
    const kind = modById.get(o.moduleId)?.kind;
    if (!KINDS.includes(kind)) continue;
    if (childArtifactCount.get(o.id)) { already++; continue; }   // already has a file
    const cover = o.meta?.cover;
    if (!cover) { noCover++; continue; }                          // TMDB never matched it
    targets.push({
      occId: o.id,
      cover,
      label: o.label ?? modById.get(o.moduleId)?.label ?? "Poster",
      userId: o.userId,
    });
  }
  return { targets, noCover, already };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));

  const { targets, noCover, already } = planPosterArtifacts({ occs, modById });

  log(`${targets.length} row(s) need a poster artifact; ${noCover} have no cover (skipped, nothing to attach).`);
  if (already) log(`  ${already} row(s) already own one — untouched.`);
  if (dryRun) { log("DRY RUN — nothing written."); return; }
  if (!targets.length) return;

  const newModules = [];
  const newOccs = [];
  const listOps = [];
  for (const t of targets) {
    const modId = uid();
    const occId = uid();
    newModules.push({
      id: modId, userId: t.userId, gridId,
      role: "artifact", kind: "image",
      label: `${t.label} poster`,
      // An ABSOLUTE url — `resolveFileRef` passes those through verbatim, which
      // is the same shape the Wikipedia image drops use. No upload, no blob.
      fileRef: t.cover,
      meta: { external: true, source: "tmdb" },
      fieldBindings: [],
    });
    newOccs.push({
      id: occId, userId: t.userId, gridId,
      moduleId: modId, targetId: modId, targetType: "module",
      parentId: t.occId,                       // its HOME — so a delete cascades
      fields: {}, meta: {},
      iteration: { mode: "persistent" },
    });
    // …and LISTED, which is what `filesOf` reads and what the delete cascade
    // walks. Parented-only would be an orphan; listed-only would have no home.
    listOps.push({
      updateOne: {
        filter: { gridId, id: t.occId },
        update: { $addToSet: { occurrences: occId } },
      },
    });
  }

  await Module.insertMany(newModules, { ordered: false });
  await Occurrence.insertMany(newOccs, { ordered: false });
  for (let i = 0; i < listOps.length; i += 500) {
    await Occurrence.bulkWrite(listOps.slice(i, i + 500), { ordered: false });
  }
  log(`minted ${newModules.length} image artifact(s), each parented to and listed by its row.`);
}
