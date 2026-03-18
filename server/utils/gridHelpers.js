// utils/gridHelpers.js
// Pure functions for grid selection logic — no DB, fully testable.

/**
 * Given a user's existing grid IDs and an optional requested gridId,
 * determine which grid to use and what action is needed.
 *
 * Actions:
 *   "use"      — use the exact gridId (requested or first existing)
 *   "fallback" — requested gridId not found; use the first existing grid
 *   "create"   — user has no grids; caller must create a new one
 *
 * @param {string[]} existingIds — Object.keys(uc.gridsById)
 * @param {string|null|undefined} requestedId — gridId from client payload
 * @returns {{ gridId: string|null, action: "use"|"fallback"|"create" }}
 */
export function selectGrid(existingIds, requestedId) {
  if (requestedId) {
    if (existingIds.includes(requestedId)) {
      return { gridId: requestedId, action: "use" };
    }
    if (existingIds.length > 0) {
      return { gridId: existingIds[0], action: "fallback" };
    }
    return { gridId: null, action: "create" };
  }
  // No gridId requested — prefer first existing over creating empty
  if (existingIds.length > 0) {
    return { gridId: existingIds[0], action: "use" };
  }
  return { gridId: null, action: "create" };
}
