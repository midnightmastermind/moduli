// server/utils/filterFields.js
//
// WHICH FIELDS DESCRIBE A PLACEMENT RATHER THAN THE THING PLACED, and what
// that means for a copy-link group.
//
// A field the grid FILTERS on decides WHERE a placement shows — on poms grid
// that is `Date`, and it is what puts a row in one day column rather than
// another. So its value is a property of the PLACEMENT, never of the thing
// placed, and two copies in two different day columns must be free to disagree
// about it.
//
// `update_occurrence` fanned every field in the payload out to every member of
// a copy-link group. Measured on the live grid 2026-08-29:
//
//   linked group lg-LnLC5V1KIMt_   8 members (the Todo source + 7 copies)
//   distinct Date values           1  ->  "2026-08-29"
//   one member's parent            "Wednesday, August 26th, 2026"
//
// A copy sitting in the AUG 26 column carrying AUG 29 cannot come from a
// per-column stamp; it comes from the fan-out. And of the "Day" template's 49
// children exactly ONE carries a Date — the Todo, the only one in a linked
// group — which is what ruled out APPLY_TEMPLATE, the first suspect.
//
// This is also why `0145` and `0271` keep having to clear the same occurrence:
// they repair the data, the next morning's stamp fans straight back in, and
// `gridIntegrity`'s `dated-copy-link-source` rule fires again. Twice now, on
// the same id, 24 hours apart.
//
// THE SOURCE OF TRUTH IS THE GRID, not a list in here. These are the keys of
// `activeFilterValues` plus every `namedFilters[].conditions[].fieldId` — the
// grid stating what it filters on. Nothing in this file learns what any
// particular field means, which is the same rule `gridIntegrity` follows for
// the check that catches the damage.
//
// ── AND THERE IS A SECOND KIND, ONE LEVEL DOWN ─────────────────────────────
//
// A filter field decides which COLUMN a placement is in. `Time Slot` decides
// which SLOT it is in, and it was still being shared: on 2026-09-06 all eight
// members of the Todo group were nulled within five seconds at the day
// rollover, twice in one day, because one member's write fanned out to the
// rest — including the master, whose value is its IDENTITY (`Schedule: Build
// Schedule` FINDs the Todo container BY it).
//
// It is derived, not listed: **a field an operation stamps FROM the
// destination container is a placement field by construction.** Measured
// across poms grid's 78 pipelines, exactly one qualifies —
//
//     Time Slot  <-  $trigger.containerLabel   (Schedule: Stamp Date & Time Slot)
//
// — and a field added later that records where a row landed is protected
// automatically, without anyone remembering to add it here.

/** @returns {Set<string>} the field ids this grid filters on. */
export function filterFieldIdsOf(grid) {
  const ids = new Set(Object.keys(grid?.activeFilterValues || {}));
  for (const nf of grid?.namedFilters || []) {
    for (const c of nf?.conditions || []) if (c?.fieldId) ids.add(c.fieldId);
  }
  return ids;
}

/**
 * Field ids some operation stamps FROM the destination container.
 *
 * A value written from `$trigger.containerLabel` (or any other
 * `$trigger.container*` / `$trigger.toContainer*` reference) records WHERE the
 * row landed. That is a fact about the placement and cannot be true of two
 * placements at once, so it must never fan out.
 *
 * Reads the stored pipelines — the grid stating what it stamps — so nothing
 * here learns what "Time Slot" is.
 *
 * @param {Array} operations
 * @returns {Set<string>}
 */
export function placementStampFieldIdsOf(operations) {
  const ids = new Set();
  const fromDestination = (v) => typeof v === "string"
    && /^\$trigger\.(container|toContainer|destContainer)/.test(v);

  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const cfg = node.config || node;
    if (cfg?.type === "UPDATE" && typeof cfg.path === "string" && fromDestination(cfg.value)) {
      const m = /fields\.([A-Za-z0-9_-]+)\.value$/.exec(cfg.path);
      if (m) ids.add(m[1]);
    }
    Object.values(node).forEach(walk);
  };
  for (const op of operations || []) walk(op?.pipeline);
  return ids;
}

/**
 * `fields` with every per-placement field removed — what may be propagated to
 * the other members of a copy-link group. Takes any number of sets so each
 * source can be refreshed at its own chokepoint (grid filters on a grid write,
 * destination stamps on an operation write) without either recomputing the
 * other.
 *
 * FAILS OPEN, deliberately. With no known filter fields (a cache not yet
 * populated) this returns the fields unchanged, i.e. today's behaviour. The
 * inverse — dropping everything when the set is unknown — would silently break
 * the sync this feature exists for, and a copy-link group that stops sharing
 * `Completed` is a worse failure than one that shares a date.
 *
 * Returns the ORIGINAL object when nothing was dropped, so the overwhelmingly
 * common write allocates nothing.
 */
export function withoutPerPlacementFields(fields, ...sets) {
  const live = (sets || []).filter((s) => s && s.size > 0);
  if (!fields || !live.length) return fields;
  let dropped = false;
  const out = {};
  for (const key of Object.keys(fields)) {
    if (live.some((s) => s.has(key))) { dropped = true; continue; }
    out[key] = fields[key];
  }
  return dropped ? out : fields;
}
