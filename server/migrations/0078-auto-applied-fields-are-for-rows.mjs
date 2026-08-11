// server/migrations/0078-auto-applied-fields-are-for-rows.mjs
//
// User, 2026-08-11: *"please hide date, tags on page headers too"* — "too"
// following *"no container should show fields right now"*.
//
// ── MEASURED THROUGH THE REAL RESOLVER FIRST ───────────────────────────────
//
//   PAGE        3 of 71   render a field   →  Routines (Tags, Date), Tasks (Date),
//                                             Schedule (Date)
//   CONTAINER 147 of 517  render Date, 40 render Tags
//   INSTANCE  454 of 703  render fields (Completed, Emotion Level, Tracker Date …)
//
// So the container half of the earlier ask was NOT actually satisfied either:
// `0067` hid every visible BINDING on container modules, but these fields do
// not come from a binding — they are the grid's auto-applied (universal) list,
// which reaches every occurrence. Hiding a binding cannot hide a field that was
// never bound.
//
// ── WHY NOT JUST WRITE `[]` ON THE PAGE'S CASCADE ─────────────────────────
//
// Because that cascade is NEAREST-WINS: `[]` on the Trackers page silences
// every occurrence beneath it, and those instances showing Date is the entire
// point of `0071`/`0073`. The cascade answers *"which fields exist here and
// below"*; this answers *"which kinds of surface render them"*. Different
// questions, so a second knob rather than a cleverer use of the first.
//
// ── ONE GRID KEY, AND IT NAMES NO FIELD ───────────────────────────────────
//
// `grid.meta.autoAppliedRoles = ["instance", "textblock"]`. Textblock is in the
// list deliberately — `88e07092` ("universal fields reach textblocks too") was
// its own ask, and dropping it here would silently undo that.
//
// ABSENT MEANS EVERY ROLE, so any grid that never runs this behaves exactly as
// it does today. That is what makes the client half safe to deploy on its own.

export const id = "0078-auto-applied-fields-are-for-rows";
export const describe =
  "Scopes the grid's auto-applied (universal) fields to instance + textblock, "
  + "so Date/Tags stop rendering on page and container HEADERS while the rows "
  + "beneath them keep showing them.";

/** The surfaces that carry data rather than chrome. */
export const ROW_ROLES = ["instance", "textblock"];

export async function up({ gridId, models, log, dryRun }) {
  const { Grid } = models;
  const grid = await Grid.findById(gridId).lean();
  if (!grid) { log("grid not found — REFUSING"); return; }

  const applied = grid.meta?.autoAppliedFieldIds || [];
  const current = grid.meta?.autoAppliedRoles;
  log(`grid auto-applies ${applied.length} field(s); autoAppliedRoles is currently ${current ? JSON.stringify(current) : "unset (every role)"}`);
  if (!applied.length) {
    // Nothing is auto-applied, so the scope would govern nothing. Setting it
    // anyway would be a write whose effect nobody could observe.
    log("no auto-applied fields on this grid — nothing for a role scope to govern");
    return;
  }
  if (Array.isArray(current) && current.length === ROW_ROLES.length
      && ROW_ROLES.every((r) => current.includes(r))) {
    log("already scoped to rows — no change"); return;
  }
  log(`→ autoAppliedRoles = ${JSON.stringify(ROW_ROLES)}`);
  if (dryRun) { log("DRY RUN — nothing written"); return; }

  // The ONE key. `meta` carries layoutTree, migrations, fieldVisibility …
  await Grid.updateOne({ _id: gridId }, { $set: { "meta.autoAppliedRoles": ROW_ROLES } });
  log("✓ page and container headers stop rendering the universal fields; rows keep them");
}
