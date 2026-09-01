// helpers/optionPoolKey.js
//
// A REACTIVE KEY FOR "COULD MY DROPDOWN'S OPTIONS HAVE CHANGED?"
//
// `FieldRenderer` used the grid-wide occurrence COUNT as the dep for option
// resolution, so ANY create anywhere re-resolved and re-rendered every
// option-resolving field. Measured on prod (2026-09-01): 756 field renders on
// an idle load, and `dropRenders=707(field:615)` on a SINGLE drop — because a
// drop creates an occurrence and the count moves.
//
// It moves for the wrong reason. Of the 49 find-mode fields on this grid:
//
//     30   fields.<Board Category> CONTAINS <tag>  AND  meta.feedSourceId IS_EMPTY
//      8   an OR-group of the same                 AND  meta.feedSourceId IS_EMPTY
//      5   fields.<Library> IS <value>
//      3   _ancestors HAS_ANCESTOR <id>
//
// 38 of 49 select by a tag that lives on BOARD ITEMS. A schedule placement —
// what a drag actually creates — carries no such tag and belongs to no pool,
// yet it invalidated all of them.
//
// NOTHING HERE KNOWS WHAT A "BOARD" IS. The scoping fields are derived from the
// grid's own find predicates, so a new dropdown scoped by some other field is
// picked up automatically and `noDomainKnowledge` stays satisfied.
//
// SAME INVALIDATION SEMANTICS AS THE COUNT IT REPLACES, which is what makes it
// safe rather than merely narrower: a count cannot see an EDIT either — moving
// an existing item from `meal` to `grocery` leaves `occurrences.length`
// unchanged exactly as it leaves this unchanged. This is strictly narrower on
// creates and deletes and identical everywhere else.

/**
 * Field ids that any find-mode predicate scopes by. Walks nested groups,
 * because 8 of the 49 are an OR of board categories.
 */
export function optionScopeFieldIds(fields) {
  const out = new Set();
  const walk = (rules) => {
    for (const r of rules || []) {
      if (r?.rules) { walk(r.rules); continue; }
      const m = /^fields\.([^.]+)\.value$/.exec(r?.left || "");
      if (m) out.add(m[1]);
    }
  };
  for (const f of fields || []) {
    const src = f?.meta?.optionsSource;
    if (src?.mode !== "find") continue;
    walk(src.predicate?.rules);
  }
  return out;
}

/**
 * How many occurrences could be IN a pool: they carry one of the scoping field
 * values and are not a feed copy (38 of 49 predicates exclude those
 * explicitly, and feedSync re-mints them on every pass — keying on them would
 * invalidate every dropdown on a schedule that changed nothing).
 */
export function poolKeyFrom(occurrences, scopeFieldIds) {
  if (!scopeFieldIds || scopeFieldIds.size === 0) return (occurrences || []).length;
  let n = 0;
  for (const o of occurrences || []) {
    if (!o || o.meta?.feedSourceId) continue;
    const f = o.fields;
    if (!f) continue;
    for (const fid of scopeFieldIds) {
      const v = f[fid]?.value;
      if (v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0)) { n++; break; }
    }
  }
  return n;
}
