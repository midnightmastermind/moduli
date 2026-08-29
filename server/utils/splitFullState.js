/**
 * Split `full_state` into what the user is LOOKING AT and what merely exists.
 *
 * ── WHY, MEASURED ──────────────────────────────────────────────────────────
 *
 * User, 2026-08-29: *"the load times are terrible on tablet. but it could be my
 * internet."* It is not (only) the internet. Measured at a tablet viewport:
 *
 *     full_state over the socket   28.74 MB decompressed   (5 frames)
 *     all HTTP for the whole app    1.85 MB                (34 requests)
 *
 * The bundle is fine; the GRID STATE is the load. And the tablet pays it twice —
 * once to inflate it, once to `JSON.parse` it on the main thread — whatever the
 * network is doing.
 *
 * THE OBVIOUS LEVER IS THE WRONG ONE, and measuring is what said so. Textmaps
 * look like the weight and are 4% of it (1.20 MB of 29.31 MB), which is also why
 * the 2026-04-11 "All Textmaps Upfront" revert was right. The weight is record
 * COUNT, and 80% of it is a catalogue nobody has open:
 *
 *     artifact   15,708 occurrences   16.15 MB   of 20.22 MB
 *        song 5,484 · album 3,027 · bookmark 1,467 · artist 1,679 · movie 993
 *     textblock   2,434   2.57 MB
 *     container   1,654   1.65 MB
 *     instance    1,206   1.07 MB
 *     page          202   0.16 MB
 *
 * Tasks, Trackers, Schedule and Projects are the instance/container/page rows —
 * about 3,000 occurrences. The Spotify and Calibre imports ride along on every
 * load of every device.
 *
 * ── PROGRESSIVE, NOT ON-DEMAND, AND THAT IS THE SAFE HALF ──────────────────
 *
 * Everything is still sent, just in two messages: the working surfaces first so
 * the grid paints, then the catalogue immediately behind it. Nothing is
 * withheld, so the 19 operations that walk `$allItems` over every row (measured
 * 2026-08-25 (2)) see exactly what they saw before — the client simply waits for
 * the second message before running its load sweep.
 *
 * True on-demand loading would save more and needs those ops audited one by one;
 * that is a separate, larger piece of work and is deliberately not this.
 *
 * ── THE SPLIT NAMES A ROLE, NOT A BOARD ────────────────────────────────────
 *
 * `role: "artifact"` is the whole rule. No label, no folder, no board id — those
 * are all one rename away from wrong, and this file records a migration that
 * moved a real page because a copied marker looked authoritative.
 *
 * AND AN ARTIFACT'S MODULE GOES WITH IT, because a module with no placement
 * renders nothing: shipping the module early buys nothing and costs 7.42 MB of
 * the payload. A module is deferred only when NOTHING in the core set places it,
 * so a poster shared with a working row is never held back.
 */

/** Occurrence roles held back for the second message. */
export const DEFERRED_ROLES = Object.freeze(["artifact"]);

/**
 * @param {Array} occurrences  every occurrence on the grid
 * @param {Array} modules      every module on the grid
 * @returns {{ core, deferred, coreModules, deferredModules }}
 */
export function splitFullState(occurrences = [], modules = []) {
  const modById = new Map(modules.map((m) => [m?.id, m]));
  const deferredRole = new Set(DEFERRED_ROLES);

  const core = [], deferred = [];
  for (const o of occurrences) {
    const role = modById.get(o?.moduleId)?.role;
    (deferredRole.has(role) ? deferred : core).push(o);
  }

  // A module is only deferred when nothing in the CORE set places it. An
  // artifact module that also backs a working row must arrive with the core, or
  // that row renders module-less until the second message lands.
  const placedByCore = new Set(core.map((o) => o?.moduleId));
  const coreModules = [], deferredModules = [];
  for (const m of modules) {
    const holdable = deferredRole.has(m?.role) && !placedByCore.has(m?.id);
    (holdable ? deferredModules : coreModules).push(m);
  }

  return { core, deferred, coreModules, deferredModules };
}
