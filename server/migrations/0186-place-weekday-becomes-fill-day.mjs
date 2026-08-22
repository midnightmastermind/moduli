/**
 * 0186 — `Schedule: Place Weekday` is renamed `Schedule: Fill Day`.
 *
 * USER, 2026-08-22: *"we should have a build schedule that builds the initial schedule and then a
 * fill day which fills it with the meal, workout, and routine template"*.
 *
 * ── THE ARCHITECTURE ALREADY MATCHES; THE NAME DID NOT ──────────────────────────────────────
 *
 * That is now exactly what runs, and `0185` was the last piece of it:
 *
 *     Schedule: Build Schedule   mints the day column and COPY_LINKs `Day`'s 49 slots
 *     Schedule: Fill Day         merges EVERY layer whose `Weekday` contains the day —
 *                                Routine (all seven) · Meals (all seven) · that day's workout
 *
 * `Place Weekday` was accurate when it resolved ONE weekday template. Since `0177` it loops every
 * layer on the Schedule Template page, so the name describes a mechanism it outgrew — and a name
 * that describes the old mechanism is how the next person builds the wrong thing.
 *
 * ── A RENAME IS ONLY SAFE IF NOTHING RESOLVES IT BY NAME, AND THAT IS CHECKED, NOT ASSUMED ──
 *
 * Verified before writing: no runtime code resolves an operation by name (ops are matched by
 * trigger and referenced by id), and no stored pipeline mentions this one. The one name-based
 * reference anywhere is `0173`'s `EXEMPLAR = "Schedule: Place Weekday"` — a MIGRATION-time lookup,
 * and migrations run in order, so on a fresh grid `0173` runs long before this rename. On a grid
 * that has already seen `0173` there is nothing left for it to look up.
 *
 * **This migration re-checks that at run time anyway** and refuses if any pipeline or trigger names
 * the old string, because "I grepped once" is not a guard.
 *
 * ── AND IT DELIBERATELY DOES NOT TOUCH `Schedule: Place Weekday Tasks` ──────────────────────
 *
 * A different op, whose name is a PREFIX MATCH of this one. Renaming by `startsWith` or by a loose
 * `includes` would take it too — the `0035` class, where a selector matches more than it names. The
 * match is exact equality.
 */
export const id = "0186-place-weekday-becomes-fill-day";
export const describe =
  "Rename `Schedule: Place Weekday` to `Schedule: Fill Day`. Renames nothing else; refuses if anything references the old name.";

const OLD = "Schedule: Place Weekday";
const NEW = "Schedule: Fill Day";

/** Exact equality, never a prefix — `Schedule: Place Weekday Tasks` is a different operation. */
export function isTheOp(op) {
  return op?.name === OLD;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation } = models;
  const ops = await Operation.find({ gridId }).lean();

  if (ops.some((o) => o.name === NEW)) { log(`  \`${NEW}\` already exists — nothing to do`); return; }
  const op = ops.find(isTheOp);
  if (!op) { log(`  no operation named \`${OLD}\` on this grid`); return; }

  // The guard: nothing may resolve it by name.
  // Scan everything EXCEPT each op's own `name`. The first version did not, and refused
  // immediately — because `Schedule: Place Weekday Tasks` carries the old string as a PREFIX
  // of its own name. That is the very thing that makes it a different operation, not a
  // reference to this one. A guard that fires on the sibling it was written to protect is a
  // false positive, and it would have blocked the rename forever.
  const referrers = ops.filter((o) => {
    if (o.id === op.id) return false;
    const { name, ...rest } = o;
    return JSON.stringify(rest).includes(OLD);
  }).map((o) => o.name);
  if (referrers.length) {
    log(`  REFUSING: ${referrers.length} operation(s) reference the old name in their own definition: ${referrers.join(", ")}`);
    return;
  }
  const siblings = ops.filter((o) => o.name?.startsWith(OLD) && o.name !== OLD).map((o) => o.name);
  log(`  renaming ${op.id}: "${OLD}" -> "${NEW}"`);
  if (siblings.length) log(`  leaving alone (prefix match, different operation): ${siblings.join(", ")}`);

  if (dryRun) { log("  (dry run — nothing written)"); return; }
  await Operation.updateOne({ id: op.id, gridId }, { $set: { name: NEW } });
  log("  written — RESTART pm2 and reload.");
}
