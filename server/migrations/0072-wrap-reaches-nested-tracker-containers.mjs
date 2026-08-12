// server/migrations/0072-wrap-reaches-nested-tracker-containers.mjs
//
// User, 2026-08-11: *"why arent the workout trackers boxes like the rest of the
// tracker instances... every tracker instance should be that same layout.
// planning, nutrition, and media arent boxes either"* → *"they should be that
// same box wrap layout"*.
//
// ── A REGRESSION I INTRODUCED, AND THE CAUSE IS EXACT ──────────────────────
//
// Removing the layout cascade (`stripSurfaceShape`) meant a page's `wrap` no
// longer reaches the containers beneath it. `0068` was written to preserve the
// rendering by copying that arrangement onto the containers that had been
// inheriting it — but it only walked DIRECT children of the page.
//
// Four tracker containers are NESTED one level deeper (2026-07-30 nested
// Workout + Nutrition under Physical, Media under Intellectual, Planning under
// Occupational), so they got nothing:
//
//   Today's Stats … Financial   depth 0   wrap ✔   (10 containers)
//   Today's Workout             depth 1   wrap ✘   8 instances
//   Today's Nutrition           depth 1   wrap ✘   2 instances
//   Today's Media               depth 1   wrap ✘   3 instances
//   Today's Planning            depth 1   wrap ✘   2 instances
//
// Their instances rendered as full-width rows instead of boxes. This walks the
// WHOLE subtree rather than one level, which is what the cascade used to do.
//
// ── WHY MATERIALISING IS STILL THE RIGHT ANSWER ───────────────────────────
//
// The obvious "fix" is to put the cascade back. That is the thing the user
// removed on purpose — a page saying "wrap" cannot sensibly mean "and every
// container beneath you, whatever kind you are", because a doc container
// renders a TEXTMAP and has no child list to arrange. Materialising the value
// per container keeps the arrangement explicit and editable on the surface it
// applies to.
//
// KNOWN CONSEQUENCE, worth stating rather than discovering later: a container
// created UNDER a wrapping one in future will not inherit the wrap. It has to
// be set on that container (the Layout menu does it). That is the trade the
// no-cascade decision makes, and it is why this is a migration rather than a
// resolver change.

export const id = "0072-wrap-reaches-nested-tracker-containers";
export const describe =
  "Propagates a wrapping container's arrangement through its WHOLE container "
  + "subtree, not just its direct children — the level 0068 missed, which left "
  + "the nested Workout / Nutrition / Media / Planning trackers as rows.";

/** Keep in sync with helpers/layoutCascade.SURFACE_SHAPE_KEYS. */
export const SHAPE_KEYS = [
  "mode", "columns", "childGap", "hideChildIds", "sortChildrenByField",
  "childMaxHeight", "childMinWidth", "childMaxWidth", "childContentDirection",
];

/** The part of a wrap arrangement a CONTAINER actually acts on. */
export function containerReadableShape(shape) {
  if (!shape || shape.mode !== "wrap") return null;
  const out = { mode: "wrap" };
  for (const k of ["childMinWidth", "childGap", "childMaxHeight", "childContentDirection"]) {
    if (shape[k] != null) out[k] = shape[k];
  }
  return out;
}

/**
 * Every container in `rootId`'s subtree that should carry `shape` but does not.
 *
 * PURE — the traversal and the refusals are the whole risk.
 *
 * @returns [{ id, label, next }]
 */
export function planSubtree({ rootId, shape, occById, roleOf, labelOf, maxDepth = 8 }) {
  const usable = containerReadableShape(shape);
  if (!usable) return [];
  const out = [];
  const seen = new Set([rootId]);
  const stack = [[rootId, 0]];
  while (stack.length) {
    const [id, depth] = stack.pop();
    if (depth >= maxDepth) continue;
    const occ = occById.get(id);
    if (!occ) continue;
    for (const childId of occ.occurrences || []) {
      if (seen.has(childId)) continue;      // cycle guard
      seen.add(childId);
      const child = occById.get(childId);
      if (!child || roleOf(child) !== "container") continue;
      // Recurse regardless of whether this one needs a write — a container that
      // already sets its own arrangement can still HOLD one that does not.
      stack.push([childId, depth + 1]);

      const own = child.meta?.layoutCascade || {};
      // Its own value WINS. It is a deliberate statement; the inherited one was
      // only ever a default. Also the re-run guard.
      const additions = {};
      for (const [k, v] of Object.entries(usable)) {
        if (own[k] !== undefined && own[k] !== null) continue;
        additions[k] = v;
      }
      if (!Object.keys(additions).length) continue;
      out.push({ id: child.id, label: labelOf(child), next: { ...own, ...additions } });
    }
  }
  return out;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const [mods, occs] = await Promise.all([
    Module.find({ gridId }).lean(),
    Occurrence.find({ gridId }).select("-textmap").lean(),
  ]);
  const modulesById = new Map(mods.map((m) => [m.id, m]));
  const occById = new Map(occs.map((o) => [o.id, o]));
  const roleOf = (o) => modulesById.get(o?.moduleId)?.role;
  const labelOf = (o) => o?.label || modulesById.get(o?.moduleId)?.label || o?.id;

  // Any occurrence that declares a wrapping arrangement — page OR container.
  const sources = occs.filter((o) => o.meta?.layoutCascade?.mode === "wrap");
  log(`  · surfaces declaring a wrap: ${sources.length}`);

  const writes = new Map();     // id → next  (a container under two sources is written once)
  for (const src of sources) {
    for (const w of planSubtree({
      rootId: src.id, shape: src.meta.layoutCascade, occById, roleOf, labelOf,
    })) {
      if (!writes.has(w.id)) writes.set(w.id, w);
    }
  }

  log(`  · nested containers missing the arrangement: ${writes.size}`);
  for (const w of writes.values()) log(`     ${w.label} ← ${JSON.stringify(w.next)}`);
  if (!writes.size) { log("  · every container already arranges itself — no change"); return; }
  if (dryRun) { log("  · DRY RUN — nothing written"); return; }

  for (const w of writes.values()) {
    // The ONE key — `meta` carries far more than this.
    await Occurrence.updateOne({ gridId, id: w.id }, { $set: { "meta.layoutCascade": w.next } });
  }
  log(`  ✓ ${writes.size} nested container(s) now wrap like their parent`);
}
