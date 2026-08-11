// server/migrations/0066-wider-tracker-tiles.mjs
//
// User, 2026-08-11: *"make the tracker occurances a bit wider and also let the
// containers extend full width"* … *"and a bit higher for the containers cause
// some of the trackers fields are getting cut off height wise"*.
//
// Three asks, and only ONE of them is data — this migration is that one.
//
//   wider tiles        → HERE: the stored `childMinWidth` on the Trackers page,
//                        which is what `--child-w` resolves to and therefore
//                        what overrides the CSS default.
//   full-width rows    → client: PageBoard's stack branch now states
//                        `width: 100%` on a child wrapper.
//   not cut off        → client: the wrap tile's hard `aspect-ratio: 1/1` +
//                        `overflow: hidden` became a `min-height`, so a tile
//                        with more fields grows instead of hiding them.
//
// The height ask is deliberately NOT solved here. Storing a bigger number would
// buy height only by making every tile wider, and would still CLIP the moment a
// tracker gained one more field — the clipping was the bug, not the size.
//
// WHY A MIGRATION AT ALL: `0064` stamped `meta.layoutCascade.childMinWidth = 132`
// on the Trackers page, and a stored value beats the stylesheet default. Editing
// the CSS alone would have been inert on the one grid this is for — the
// "shipped and does nothing" class this repo keeps paying for.

export const id = "0066-wider-tracker-tiles";
export const describe =
  "Widens the Trackers page's wrapped tracker tiles by raising the stored "
  + "childMinWidth (132 → 168). Idempotent, and it never lowers a width someone "
  + "has already set higher by hand.";

/** The width the tiles should be, unless the user already chose a bigger one. */
export const TARGET_CHILD_MIN_WIDTH = 168;

/**
 * PURE — the whole decision, so it is testable without a database.
 * Returns the next childMinWidth, or null when nothing should be written.
 */
export function nextChildMinWidth(current, target = TARGET_CHILD_MIN_WIDTH) {
  const cur = Number(current);
  // Absent / unusable → adopt the target (the page is wrapping either way).
  if (!Number.isFinite(cur) || cur <= 0) return target;
  // Already at or above it → leave it alone. This is what makes a re-run a
  // no-op AND what stops the migration overwriting a hand-tuned wider tile.
  if (cur >= target) return null;
  return target;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const [mods, occs] = await Promise.all([
    Module.find({ gridId }).lean(),
    Occurrence.find({ gridId }).select("-textmap").lean(),
  ]);
  const modulesById = new Map(mods.map((m) => [m.id, m]));
  const labelOf = (o) => o.label || modulesById.get(o.moduleId)?.label || "";

  const trackers = occs.find(
    (o) => modulesById.get(o.moduleId)?.role === "page" && labelOf(o) === "Trackers",
  );
  if (!trackers) { log("  · no Trackers page on this grid — nothing to do"); return; }

  const cascade = trackers.meta?.layoutCascade || null;
  if (!cascade || cascade.mode !== "wrap") {
    // Widening a page that is not wrapping would change a layout nobody asked
    // about — the tile width only means anything under the wrap rule.
    log(`  · Trackers page is not in wrap mode (mode=${cascade?.mode ?? "none"}) — REFUSING`);
    return;
  }

  const next = nextChildMinWidth(cascade.childMinWidth);
  log(`  · Trackers page ${trackers.id} — childMinWidth ${cascade.childMinWidth ?? "(unset)"} → ${next ?? "(unchanged)"}`);
  if (next == null) { log("  · already at least this wide — nothing to write"); return; }
  if (dryRun) { log("  · DRY RUN — nothing written"); return; }

  // Write the ONE key. `meta.layoutCascade` also carries `mode`, and the
  // occurrence carries fieldVisibility and more besides — a whole-meta write is
  // how those get clobbered.
  await Occurrence.updateOne(
    { gridId, id: trackers.id },
    { $set: { "meta.layoutCascade.childMinWidth": next } },
  );
  log(`  ✓ tracker tiles are now ${next}px wide (and at least that tall)`);
}
