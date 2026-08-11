// server/migrations/0067-auto-applied-fields-cascade.mjs
//
// USER, 2026-08-10: *"currently none of the trackers are showing their fields
// either… just the tags field apparently is shown on trackers right now."*
// And, on the design: *"its a cascade of shown fields and auto applied fields"*
// / *"universal fields arent anything hard coded, its just what the app sets at
// a grid level and passed down."*
//
// ── THE CAUSE ───────────────────────────────────────────────────────────────
//
// `0064` gave every occurrence Tags through a SYNTHESIZED binding, born HIDDEN,
// revealed by naming the field in an occurrence's `show`-mode `fieldVisibility`.
// It then did exactly that on the Trackers page:
//
//     fieldVisibility: { mode: "show", fieldIds: [<Tags>] }
//
// But show-mode is a WHITELIST — it means "show Tags AND NOTHING ELSE" — and
// `fieldVisibility` is a nearest-wins CASCADE, so it applied to every tracker
// container and tile underneath. Tags appeared; `Tasks Completed`, `Tasks Left`
// and `Category` vanished. The migration did the documented thing; the mechanism
// was wrong. Reusing the SHOWN cascade as the APPLIED cascade cannot work,
// because the two answer different questions.
//
// ── WHAT SHIPS WITH THIS ────────────────────────────────────────────────────
//
// Auto-applied fields are now their own nearest-wins cascade
// (`getEffectiveAutoAppliedFieldIds`), rooted at `grid.meta.autoAppliedFieldIds`
// and overridable on any occurrence via `occurrence.autoAppliedFieldIds` — a
// LIST, so *"turned off on occurances if i want"* is `[]` rather than a second
// switch. They render like any ordinary bound field; the SHOWN cascade decides
// visibility. So the whitelist is no longer needed to reveal Tags, and is now
// only doing damage.
//
// ── THIS MIGRATION ──────────────────────────────────────────────────────────
//
//   1. RENAME  grid.meta.universalFieldIds → grid.meta.autoAppliedFieldIds.
//      A rename, not a dual read: this repo's standing rule is no back-compat
//      aliases (`feedback-no-fallbacks`), and a client reading only the new key
//      against a grid carrying only the old one silently applies nothing.
//
//   2. DROP the Trackers page's show-whitelist — and ONLY when it still matches
//      the shape 0064 wrote (show-mode naming exactly the auto-applied fields).
//      If the user has since edited it, that is THEIR whitelist and it is left
//      alone with a reason logged. `0035` moved a real page because its selector
//      matched "things that look like templates"; the guard here is that the
//      value must be what the earlier migration is known to have written.
//
//      `meta.layoutCascade` (wrap + childMinWidth), set in the same 0064 write,
//      is DELIBERATELY KEPT — it is a layout choice, not part of this defect.
//
// Idempotent: a second run finds the new key already present and no matching
// whitelist, and writes nothing.

export const id = "0067-auto-applied-fields-cascade";
export const describe =
  "Rename grid.meta.universalFieldIds → autoAppliedFieldIds, and drop the Trackers page's "
  + "show-mode fieldVisibility whitelist (0064) that hid every tracker's own fields.";

const OLD_KEY = "universalFieldIds";
const NEW_KEY = "autoAppliedFieldIds";

/**
 * Is this the whitelist `0064` wrote, or has someone edited it since?
 *
 * The precise test: show-mode, and its field list is exactly the set of
 * auto-applied ids (0064 wrote `[tagsId]`, and Tags is one of them). Anything
 * else — a different mode, an extra field, a field that is not auto-applied —
 * means a human made a choice here and it is not ours to undo.
 *
 * Exported so the test drives the REAL predicate rather than a copy of it.
 */
export function isMigrationWrittenWhitelist(fieldVisibility, appliedIds) {
  if (!fieldVisibility || fieldVisibility.mode !== "show") return false;
  const listed = Array.isArray(fieldVisibility.fieldIds) ? fieldVisibility.fieldIds : null;
  if (!listed || !listed.length) return false;
  const applied = new Set(appliedIds || []);
  if (!applied.size) return false;
  // Every id listed must be an auto-applied one. A whitelist naming anything
  // else is expressing an intent this migration knows nothing about.
  return listed.every((fid) => applied.has(fid));
}

export async function up({ gridId, models, log, dryRun }) {
  const { Grid, Occurrence, Module, Field } = models;

  const grid = await Grid.findById(gridId).lean();
  if (!grid) { log("  · grid not found"); return; }

  const meta = grid.meta || {};
  const oldIds = Array.isArray(meta[OLD_KEY]) ? meta[OLD_KEY] : null;
  const newIds = Array.isArray(meta[NEW_KEY]) ? meta[NEW_KEY] : null;
  const appliedIds = newIds || oldIds || [];

  // Report by NAME, not by id — an id tells the reader nothing about whether
  // the right fields are about to be carried by every occurrence on the grid.
  const fields = await Field.find({ gridId }).lean();
  const nameOf = (fid) => fields.find((f) => f.id === fid)?.name || `(unknown ${fid.slice(0, 6)})`;

  // ── 1. the key rename ─────────────────────────────────────────────────────
  if (oldIds && !newIds) {
    log(`  · RENAME meta.${OLD_KEY} → meta.${NEW_KEY}: [${appliedIds.map(nameOf).join(", ")}]`);
    if (!dryRun) {
      await Grid.updateOne({ _id: gridId }, {
        $set: { [`meta.${NEW_KEY}`]: appliedIds },
        $unset: { [`meta.${OLD_KEY}`]: "" },
      });
    }
  } else if (oldIds && newIds) {
    // Both present — do not guess which is authoritative. The new key wins (it
    // is what the client reads) and the stale one is removed, which is the only
    // outcome that cannot leave the grid in a half-renamed state.
    log(`  · both keys present — keeping meta.${NEW_KEY} [${newIds.map(nameOf).join(", ")}], dropping the stale meta.${OLD_KEY}`);
    if (!dryRun) {
      await Grid.updateOne({ _id: gridId }, { $unset: { [`meta.${OLD_KEY}`]: "" } });
    }
  } else if (newIds) {
    log(`  · meta.${NEW_KEY} already present [${newIds.map(nameOf).join(", ")}] — no rename needed`);
  } else {
    log("  · this grid names no auto-applied fields — nothing to rename");
  }

  // ── 2. the Trackers whitelist ─────────────────────────────────────────────
  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const labelOf = (o) => o.label ?? modById.get(o.moduleId)?.label ?? "(unlabelled)";

  // Resolved the way 0064 found it — by label + page role — so the two agree
  // about which occurrence is being talked about.
  const trackers = occs.find((o) =>
    modById.get(o.moduleId)?.role === "page" && labelOf(o) === "Trackers");

  if (!trackers) {
    log("  · no \"Trackers\" page on this grid — nothing to unblock");
  } else if (!trackers.fieldVisibility) {
    log("  · Trackers page carries no fieldVisibility — already clear");
  } else if (!isMigrationWrittenWhitelist(trackers.fieldVisibility, appliedIds)) {
    // Fails CLOSED and says why, rather than removing a setting a human chose.
    log(`  · REFUSED to touch the Trackers page: its fieldVisibility is `
      + `${JSON.stringify(trackers.fieldVisibility)}, which is not the show-whitelist 0064 wrote `
      + `(expected mode "show" naming only auto-applied fields). Left alone.`);
  } else {
    const names = trackers.fieldVisibility.fieldIds.map(nameOf).join(", ");
    log(`  · Trackers page (${trackers.id.slice(0, 8)}) DROPS its show-whitelist [${names}]`);
    log("    (a show-mode list is a WHITELIST — it was hiding every tracker's own bound fields;");
    log("     auto-applied fields no longer need it, and meta.layoutCascade is kept as-is)");
    if (!dryRun) {
      await Occurrence.updateOne({ gridId, id: trackers.id }, { $unset: { fieldVisibility: "" } });
    }
  }
}
