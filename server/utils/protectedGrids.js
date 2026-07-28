// utils/protectedGrids.js
//
// THE single source of truth for "which grids may a script never destroy".
//
// Background: `poms grid` is permanent live data (user, 2026-07-28). It is
// built from the seed exactly once and from then on only the running app and
// reviewed migrations write it. Six separate code paths could destroy it
// before this module existed — the reseed drop, the stale-grid sweep, --clear,
// resetData.js, clearUserData.js, and the runtime delete_grid handler — and
// each carried (or lacked) its own copy of the rule. One list, imported
// everywhere, is the only version of this that stays true.
//
// Name matching is case-insensitive and trims, because the name is typed by a
// human in the grid picker. It is deliberately NOT the only defence: the grid
// also carries `meta.protected`, which survives a rename (see isProtectedGrid).

/** Grids no script in this repo may drop, clear, or reseed. */
export const PROTECTED_GRID_NAMES = Object.freeze([
  "poms grid",   // the live data
  "test grid 1", // the frozen pre-2026-07-25 live grid
]);

const NORMALIZED = new Set(PROTECTED_GRID_NAMES.map(n => n.toLowerCase()));

/** True when this NAME is on the protected list. */
export function isProtectedGridName(name) {
  return NORMALIZED.has(String(name ?? "").trim().toLowerCase());
}

/**
 * True when this GRID is protected — by name, or by the `meta.protected` stamp
 * that a freeze applies. The stamp is what survives a rename, so it is checked
 * independently rather than as a fallback.
 */
export function isProtectedGrid(grid) {
  if (!grid) return false;
  return isProtectedGridName(grid.name) || grid?.meta?.protected === true;
}

/**
 * Throw unless it is safe to destroy this grid. Callers pass whatever they
 * have — a name string or a grid document.
 *
 * THROWS rather than returning false on purpose: every caller is about to run
 * a deleteMany, and a boolean that someone forgets to check is not a guard.
 */
export function assertNotProtected(gridOrName, action = "modify") {
  const grid = typeof gridOrName === "string" ? { name: gridOrName } : gridOrName;
  if (!isProtectedGrid(grid)) return;
  const label = grid?.name || grid?._id || "(unnamed)";
  throw new Error(
    `Refusing to ${action} "${label}" — it is protected live data. ` +
    `Protected: ${PROTECTED_GRID_NAMES.join(", ")} (plus any grid with meta.protected). ` +
    `Back it up with server/scripts/backupGrid.js and change it through a migration instead.`
  );
}

/** Split a list of grid documents into { safe, protected }. */
export function partitionProtected(grids = []) {
  const out = { safe: [], protected: [] };
  for (const g of grids) (isProtectedGrid(g) ? out.protected : out.safe).push(g);
  return out;
}

/**
 * Every protected gridId this user owns. `meta` is selected because protection
 * can ride on `meta.protected`, which is what survives a rename.
 */
export async function protectedGridIdsForUser(GridModel, userId) {
  const grids = await GridModel.find({ userId }).select({ _id: 1, name: 1, meta: 1 }).lean();
  return grids.filter(isProtectedGrid).map(g => g._id.toString());
}

/**
 * Narrow a delete filter so it can never reach a protected grid's documents.
 *
 * Scripts that wipe a whole user (`{ userId }`) are the dangerous shape: every
 * grid-scoped collection carries `gridId`, so excluding those ids is what keeps
 * a "reset my data" from taking the live grid with it.
 */
export function withProtectedExcluded(baseFilter, protectedIds = []) {
  if (!protectedIds.length) return baseFilter;
  return { $and: [baseFilter, { gridId: { $nin: protectedIds } }] };
}
