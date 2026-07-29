// Clear `kind` from instance- and panel-role modules.
//
// `kind` is the sub-type WITHIN a role: it decides how a container renders
// (board/doc/canvas/table/pool), which page shape to draw, which viewer an
// artifact gets, and whether a textblock is the inline chip or the block card.
// On an instance or a panel it means nothing — no code reads it.
//
// It is not harmless, though. `getModuleTypeIcon` resolves kind BEFORE role, so
// the 539 instance modules carrying `kind:"board"` rendered the BOARD icon
// instead of the instance icon everywhere an icon appears (pickers, trees,
// quick-add tiles, representation chips), and the 5 panels did the same.
//
// The seed stopped writing it on 2026-07-29; this reaches the frozen grids.
export const id = "0003-clear-inert-leaf-kind";
export const describe =
  "Unsets `kind` on instance- and panel-role modules (inert there, and it makes the icon " +
  "resolver draw the wrong icon). Touches no occurrence, field or operation.";

// Roles where kind carries meaning — never touched.
const KIND_BEARING = ["container", "page", "artifact", "textblock"];

export async function up({ gridId, models, log, dryRun }) {
  const { Module } = models;

  const doomed = await Module.find({
    gridId, role: { $in: ["instance", "panel"] }, kind: { $ne: null },
  }).select({ id: 1, role: 1, kind: 1, label: 1 }).lean();

  if (!doomed.length) { log("no instance/panel module carries a kind — nothing to do"); return; }

  const byKind = {};
  for (const m of doomed) byKind[`${m.role}/${m.kind}`] = (byKind[`${m.role}/${m.kind}`] || 0) + 1;
  log(`${doomed.length} module(s): ${Object.entries(byKind).map(([k, n]) => `${k}×${n}`).join(", ")}`);

  // Sanity: the kind-bearing roles must be untouched by this filter.
  const bearing = await Module.countDocuments({ gridId, role: { $in: KIND_BEARING }, kind: { $ne: null } });
  log(`leaving ${bearing} container/page/artifact/textblock module(s) with their kind intact`);

  if (dryRun) { log("dry run — would unset kind on the listed modules"); return; }

  const { modifiedCount } = await Module.updateMany(
    { gridId, role: { $in: ["instance", "panel"] }, kind: { $ne: null } },
    { $unset: { kind: "" } },
  );
  log(`cleared kind on ${modifiedCount} module(s)`);
}
