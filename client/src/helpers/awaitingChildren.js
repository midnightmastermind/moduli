/**
 * "This container is still LOADING" vs "this container is EMPTY".
 *
 * ── WHY, MEASURED ──────────────────────────────────────────────────────────
 *
 * `server/utils/splitFullState.js` ships the working surfaces first and the
 * 15,708-row artifact catalogue immediately behind them. Between the two
 * messages a board LISTS its children and none of them resolve — so it paints
 * its EMPTY state, complete with "Add new item", for as long as the second
 * message takes. On the device that is seconds:
 *
 *     user, 2026-09-03: "the books took 2 more seconds to load (without a
 *     loading bar, we need that if its gonna be the case) ... it loaded the
 *     books container but nothing was inside for a couple seconds"
 *
 * ── THE SIGNAL IS THE UNRESOLVED LISTING, NOT A ROLE OR A BOARD ────────────
 *
 * Measured on the live grid: every deferred row is LISTED by its board's
 * `occurrences[]` (Books 590/590, Songs 5,484/5,484, and 1,215 containers in
 * total), so "lists children that do not resolve" is exact. Nothing here names
 * an artifact, a board, a kind or a label — `noDomainKnowledge.test.js` fails
 * the build if a generic renderer learns what a book is, and a rule keyed on
 * role would be one `DEFERRED_ROLES` edit away from wrong.
 *
 * ── AND IT IS GATED ON THE GRID ACTUALLY WAITING ───────────────────────────
 *
 * An unresolved child id is ALSO the signature of a dangling child ref, which
 * `gridIntegrity` reports as an error and which does not resolve by waiting.
 * Without the gate a grid carrying one would show a spinner forever. The flag
 * is set from the server's own `deferredCount` and cleared when the catalogue
 * lands, so the loading state cannot outlive the load.
 *
 * A container that lists NOTHING is empty, not loading — that is the ordinary
 * empty state and it must keep its "Add new item" affordance during a load.
 *
 * Takes the RESOLVED children the container already holds — `ModuleContainer`
 * maps its `occurrences[]` to occurrence-or-null for rendering anyway, so the
 * signal costs no extra subscription and cannot disagree with what is drawn.
 *
 * @param {Array<object|null>} resolvedChildren  listed children, null when unresolved
 * @param {boolean}            awaitingDeferred  is the deferred half still in flight
 */
export function isAwaitingChildren(resolvedChildren, awaitingDeferred) {
  if (!awaitingDeferred) return false;
  if (!Array.isArray(resolvedChildren) || resolvedChildren.length === 0) return false;
  return resolvedChildren.some((o) => !o);
}
