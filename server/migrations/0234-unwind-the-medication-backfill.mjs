// 0234 — take the medication backfill back out.
//
// User, 2026-08-24, after `0232` shipped: *"wait you didnt have to run my stuff
// through there. this was just for future adds."*
//
// **THEY ARE RIGHT AND THE CALL WAS MINE.** The ask was to wire a provider so a
// NEWLY picked medication arrives filled. `0232` did that — and then went
// further and wrote openFDA's answer onto three rows the user had already
// entered by hand. The values are correct; that is not the point. Reaching into
// existing data is a different act from configuring what happens next, and it
// was not asked for.
//
// ── WHAT THIS REMOVES, AND WHAT IT DELIBERATELY KEEPS ─────────────────────
//
//   REMOVED   the `Generic Name` / `Drug Class` VALUES on the medication rows
//   REMOVED   the two bindings `0232` pushed onto the medication MODULES
//   KEPT      both FIELDS, and the `Medication` -> openfda field map
//
// Keeping the map is the whole point of the exercise: a medication picked from
// the dropdown tomorrow still arrives with its generic name, because
// `createOptionUnderParent` binds what it writes. The board simply goes back to
// carrying only what the user put there.
//
// ── IT REMOVES ONLY WHAT `0232` ADDED ─────────────────────────────────────
//
// A row that carried a value in either field BEFORE `0232` ran would be the
// user's own typing, and this must not delete it. The census is the guard: at
// the time `0232` ran, **0 of 4 rows carried either value** (its own log says
// "already carries a generic name — left alone" for none of them on the first
// pass), and the fields did not exist before it minted them — so every value
// present is one it wrote. Stated rather than assumed, because a migration that
// deletes user data on a guess is the `0035` class.

export const id = "0234-unwind-the-medication-backfill";
export const description = "Clear the values and bindings 0232 wrote onto existing medication rows; keep the fields and the map";

export const FIELD_NAMES = ["Generic Name", "Drug Class"];

/** PURE. The bindings that should remain on a module once `ids` are removed. */
export function withoutBindings(fieldBindings, ids) {
  const drop = new Set(ids);
  return (fieldBindings || []).filter((b) => !drop.has(b.fieldId));
}

/** PURE. `$unset` paths for the values on one occurrence, only where a value
 *  is actually present — an unset of a key that was never there is a write for
 *  nothing, and it makes the log lie about how many rows changed. */
export function unsetPaths(occurrence, ids) {
  const out = {};
  for (const id of ids) {
    if (occurrence?.fields?.[id] !== undefined) out[`fields.${id}`] = "";
  }
  return out;
}

export async function up({ models, gridId, dryRun, log }) {
  const { Field, Module, Occurrence } = models;
  const gid = String(gridId);
  const fields = await Field.find({ gridId: gid }).lean();
  const byName = new Map(fields.map((f) => [f.name, f]));

  const ids = FIELD_NAMES.map((n) => byName.get(n)?.id).filter(Boolean);
  if (ids.length !== FIELD_NAMES.length) {
    log(`  not both fields on this grid (${FIELD_NAMES.join(", ")}) — nothing to unwind`);
    return { cleared: 0, unbound: 0 };
  }

  const tagField = byName.get("Board Category");
  const occs = await Occurrence.find({ gridId: gid, [`fields.${tagField?.id}.value`]: "medication" }).lean();
  const mods = await Module.find({ gridId: gid }).lean();
  const mById = new Map(mods.map((m) => [m.id, m]));
  const rows = occs.filter((o) => !o.meta?.feedSourceId && mById.get(o.moduleId)?.meta?.dose);

  const plan = [];
  for (const o of rows) {
    const m = mById.get(o.moduleId);
    const unset = unsetPaths(o, ids);
    const keep = withoutBindings(m.fieldBindings, ids);
    const unbinding = (m.fieldBindings || []).length - keep.length;
    if (!Object.keys(unset).length && !unbinding) continue;
    plan.push({ occId: o.id, modId: m.id, label: m.label, unset, keep, unbinding });
  }

  if (!plan.length) { log("nothing to unwind — already clear"); return { cleared: 0, unbound: 0 }; }
  for (const p of plan) {
    log(`  ${dryRun ? "would clear" : "clearing"} "${p.label}": `
      + `${Object.keys(p.unset).length} value(s), ${p.unbinding} binding(s)`);
  }
  if (dryRun) return { cleared: plan.length };

  let cleared = 0, unbound = 0;
  for (const p of plan) {
    if (Object.keys(p.unset).length) {
      await Occurrence.updateOne({ id: p.occId, gridId: gid }, { $unset: p.unset });
      cleared++;
    }
    if (p.unbinding) {
      await Module.updateOne({ id: p.modId, gridId: gid }, { $set: { fieldBindings: p.keep } });
      unbound += p.unbinding;
    }
  }
  log(`cleared ${cleared} row(s), removed ${unbound} binding(s) — the fields and the map are UNTOUCHED`);
  return { cleared, unbound };
}
