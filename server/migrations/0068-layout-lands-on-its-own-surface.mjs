// server/migrations/0068-layout-lands-on-its-own-surface.mjs
//
// User, 2026-08-11: *"we need to remove cascade from the layout ui"* …
// *"we want layout, just not cascaded dude"*.
//
// The client change (helpers/layoutCascade.stripSurfaceShape) stops an ANCESTOR
// contributing SHAPE keys — mode / columns / childGap / childMinWidth /
// childMaxWidth / childMaxHeight / hideChildIds / sortChildrenByField. A
// surface now arranges its own children and nobody else's.
//
// ── WITHOUT THIS MIGRATION THE CLIENT CHANGE IS A REGRESSION ───────────────
//
// The Trackers page stores `mode: "wrap"` + `childMinWidth`, and that is what
// made the tracker tiles wrap into a grid — by reaching DOWN into every
// container beneath it. Stop the cascade and the tiles snap back to full-width
// rows. So the arrangement has to be written onto the containers that were
// relying on inheriting it, which is what this does: it moves the intent from
// "the page arranges everyone" to "each container arranges itself", with the
// same visible result.
//
// ── IT COPIES, IT DOES NOT MOVE ────────────────────────────────────────────
//
// The parent KEEPS its shape keys, because they still describe how the PARENT
// arranges its own children (`resolveLayoutCascade`'s leaf layer reads
// `leafOcc.meta.layoutCascade`'s shape). Removing them would change how the
// page itself lays out. Only the descendants gain a copy.
//
// ── AND IT NEVER OVERWRITES ────────────────────────────────────────────────
//
// A child that already sets a key wins — it made a deliberate statement and
// the parent's value was only ever a default it happened to inherit. That is
// also what makes a re-run a no-op.
//
// GENERIC BY CONSTRUCTION: it walks every occurrence carrying shape keys, not
// the Trackers page by name. Measured 2026-08-10: only 5 occurrences on three
// grids carry a layout cascade at all, so the blast radius is tiny and known.

export const id = "0068-layout-lands-on-its-own-surface";
export const describe =
  "Layout stops cascading: copies a parent's SHAPE keys onto the container "
  + "children that were inheriting them, so each surface arranges itself and "
  + "the rendering is unchanged. Never overwrites a child's own value.";

/** Keep in sync with helpers/layoutCascade.SURFACE_SHAPE_KEYS. */
export const SHAPE_KEYS = [
  "mode", "columns", "childGap", "hideChildIds", "sortChildrenByField",
  "childMaxHeight", "childMinWidth", "childMaxWidth",
];

/** The shape-only part of a rule, or null. */
export function shapeOf(rule) {
  if (!rule) return null;
  const out = {};
  for (const k of SHAPE_KEYS) {
    if (rule[k] !== undefined && rule[k] !== null) out[k] = rule[k];
  }
  return Object.keys(out).length ? out : null;
}

/**
 * The part of an inherited shape a CONTAINER can actually act on.
 *
 * `ModuleContainer` implements exactly one arrangement — `mode === "wrap"` —
 * plus `childMinWidth` and `childGap`. It ignores stack / flex-row / grid
 * entirely (those are `PageBoard`'s vocabulary).
 *
 * SO ONLY `wrap` IS WORTH PROPAGATING, and that is a correctness point rather
 * than tidiness: the Day Page pushes `mode: "flex-row"` down to its day
 * columns, which has always been INERT because no container reads it. Copying
 * it onto them would preserve nothing today and would silently rearrange every
 * day column the moment `ModuleContainer` learned that mode. This migration
 * preserves BEHAVIOUR, so it copies only what currently produces behaviour.
 */
export function containerReadableShape(shape) {
  if (!shape || shape.mode !== "wrap") return null;
  const out = { mode: "wrap" };
  if (shape.childMinWidth != null) out.childMinWidth = shape.childMinWidth;
  if (shape.childGap != null) out.childGap = shape.childGap;
  if (shape.childMaxHeight != null) out.childMaxHeight = shape.childMaxHeight;
  return out;
}

/**
 * What a child should end up storing, given the shape it was inheriting.
 * Returns null when nothing needs writing — the child already covers every key.
 *
 * PURE: the whole decision, testable without a database.
 */
export function mergeInheritedShape(childCascade, inheritedShape) {
  if (!inheritedShape) return null;
  const own = childCascade || {};
  const additions = {};
  for (const [k, v] of Object.entries(inheritedShape)) {
    // The child's own value WINS — it is a deliberate statement, where the
    // parent's was only ever an inherited default.
    if (own[k] !== undefined && own[k] !== null) continue;
    additions[k] = v;
  }
  if (!Object.keys(additions).length) return null;
  return { ...own, ...additions };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const [mods, occs] = await Promise.all([
    Module.find({ gridId }).lean(),
    Occurrence.find({ gridId }).select("-textmap").lean(),
  ]);
  const modulesById = new Map(mods.map((m) => [m.id, m]));
  const occById = new Map(occs.map((o) => [o.id, o]));
  const roleOf = (o) => modulesById.get(o.moduleId)?.role;
  const labelOf = (o) => o.label || modulesById.get(o.moduleId)?.label || o.id;

  // Every occurrence that was PUSHING a shape down.
  const sources = occs
    .map((o) => ({ occ: o, shape: shapeOf(o.meta?.layoutCascade) }))
    .filter((x) => x.shape);

  log(`  · occurrences carrying layout shape: ${sources.length}`);
  if (!sources.length) { log("  · nothing was cascading — nothing to preserve"); return; }

  const writes = [];
  for (const { occ, shape } of sources) {
    log(`     "${labelOf(occ)}" [${roleOf(occ)}] → ${JSON.stringify(shape)}`);
    // Direct CONTAINER children only. A container is the only descendant that
    // arranges a child list of its own; pushing a page's shape onto a leaf or a
    // doc would be inventing an arrangement for something that has none.
    for (const childId of occ.occurrences || []) {
      const child = occById.get(childId);
      if (!child || roleOf(child) !== "container") continue;
      const usable = containerReadableShape(shape);
      if (!usable) continue;            // inert inheritance — nothing to preserve
      const next = mergeInheritedShape(child.meta?.layoutCascade, usable);
      if (!next) continue;
      writes.push({ id: child.id, label: labelOf(child), next });
    }
  }

  log(`  · container children that need their own copy: ${writes.length}`);
  for (const w of writes.slice(0, 8)) log(`     ${w.label} ← ${JSON.stringify(w.next)}`);
  if (writes.length > 8) log(`     … +${writes.length - 8} more`);
  if (!writes.length) { log("  · every child already arranges itself — no change"); return; }
  if (dryRun) { log("  · DRY RUN — nothing written"); return; }

  for (const w of writes) {
    // Write the ONE key. `meta` carries far more than this.
    await Occurrence.updateOne(
      { gridId, id: w.id },
      { $set: { "meta.layoutCascade": w.next } },
    );
  }
  log(`  ✓ ${writes.length} container(s) now carry their own layout; the parent keeps its own`);
}
