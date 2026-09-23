// helpers/occurrenceCrumbs.js
//
// TELLING TWO SAME-NAMED OCCURRENCES APART, in one place.
//
// USER, 2026-09-23: *"in those places where its hard to tell occurances apart
// due to same name (diff selects and such), we need to show the occurances
// ancestor chain"*.
//
// Sharing a label is the NORM on a real grid, not an edge case. Measured
// 2026-09-23:
//
//     poms grid   22,479 occurrences · 1,972 labels shared by 2+
//                 6,763 rows (30%) carry a label some other row also has
//                 worst: "Sleep" x158 · "Drink" x105 · "Eat" x94
//
// A picker showing five bare "Sleep"s is asking the user to guess.
//
// ── WHY ONLY THE AMBIGUOUS ONES GET A CRUMB ────────────────────────────────
//
// What matters is a collision INSIDE THE LIST BEING SHOWN, not grid-wide: a
// dropdown scoped to meals may hold no duplicates at all even though the grid
// holds hundreds. Crumbing every row would put a breadcrumb on the ~70% that
// read fine and make the common case worse to scan — and on poms it would add
// one to 15,901 unique labels to help 1,972.
//
// It is also what keeps this affordable. `resolveOptions` is a documented hot
// path (1,381ms of the 2026-08-07 date-navigation profile), so the crumb work
// is done for the DUPLICATES only, after an O(n) count — never per option.
//
// ── AND IT CANNOT ALWAYS HELP, WHICH THE CALLER HAS TO KNOW ────────────────
//
// Two occurrences that share a label AND a parent produce the same crumb. The
// template picker is exactly that shape — every template is a child of the one
// protected "Templates" folder, so two saves of "Morning Slot" both read
// "Templates › Morning Slot". `disambiguateOptions` reports what it could not
// separate rather than silently decorating; a caller with a better
// discriminator (a date, a source) can use it for those.

export const CRUMB_SEP = " › ";

/** A guard against a malformed chain, NOT a display choice. The whole chain is
 *  shown (user, 2026-09-23: *"and yes full ancestory"*) — an earlier version
 *  kept only the nearest two, which on poms drops a real level: a schedule row
 *  sits under `Schedule Template › Schedule: Routine › 6:00am`, and showing two
 *  of those three hides where the slot actually lives. */
export const MAX_CRUMB_DEPTH = 12;

/**
 * "Schedule › 12:00pm" for an occurrence, from an ancestor id list.
 *
 * `ancestorIds` is CLOSEST-FIRST — the shape `optionsResolver` and the
 * operation executor already enrich records with (`_ancestors`), so the common
 * caller needs no second walk over the tree.
 *
 * Folders are resolved too: a page is FILED in a folder rather than listed by
 * an occurrence, so a template's or a page's chain lives in `foldersById`.
 *
 * @returns {string} "" when there is nothing to say.
 */
export function crumbFromAncestors(ancestorIds, {
  occurrencesById = {}, modulesById = {}, foldersById = null, maxDepth = MAX_CRUMB_DEPTH,
} = {}) {
  if (!Array.isArray(ancestorIds) || ancestorIds.length === 0) return "";
  const names = [];
  for (const id of ancestorIds) {              // closest first
    if (names.length >= maxDepth) break;
    const occ = occurrencesById[id];
    if (occ) {
      const name = occ.label || modulesById[occ.moduleId]?.label || null;
      if (name) names.push(name);
      // STOP AT THE PAGE. It is the surface a person navigates to, and what
      // sits above it is layout chrome — a panel is called "Panel D". Going
      // further would add a name that tells you nothing about where the row is.
      if (modulesById[occ.moduleId]?.role === "page") break;
      continue;
    }
    const folder = foldersById?.[id];
    if (folder?.name) {
      // A page is FILED in a folder rather than listed by an occurrence, so a
      // folder is a real home and the end of the walk.
      names.push(folder.name);
      break;
    }
  }
  return names.reverse().join(CRUMB_SEP);      // root-most first
}

/**
 * Walk an occurrence's ancestors when the caller has no `_ancestors` to hand.
 *
 * Placement on this grid IS the parent's child list, so the reverse map built
 * from `occurrences[]` is preferred over the child's own `parentId` — a row can
 * be listed by one occurrence while `parentId` names another. Falls back to
 * `parentId`, which is how a page reaches its FOLDER.
 */
export function ancestorIdsOf(occId, { occurrencesById = {}, parentByChild = null } = {}) {
  const pbc = parentByChild || (() => {
    const m = {};
    for (const o of Object.values(occurrencesById)) {
      for (const c of o?.occurrences || []) m[c] = o.id;
    }
    return m;
  })();
  const out = [];
  const seen = new Set([occId]);
  let cur = occId;
  let depth = 0;
  while (cur && depth++ < 16) {
    const next = pbc[cur] ?? occurrencesById[cur]?.parentId ?? null;
    if (!next || seen.has(next)) break;
    seen.add(next);
    out.push(next);
    cur = next;
  }
  return out;
}

/**
 * Suffix the labels that COLLIDE inside this list with their ancestor chain.
 *
 * Pure, and it never touches an option's `value` — only what is shown. A caller
 * that re-reads the label to find the option again would break otherwise, and
 * `optionsResolver`'s consumers match on value.
 *
 * @param options  [{ value, label, ... }]
 * @param crumbOf  (option) => string   the chain for that option, "" for none
 * @returns {{ options: Array, ambiguous: number, unresolved: number }}
 *          `unresolved` counts options still sharing a display label after
 *          crumbing — same label AND same chain, which a chain cannot fix.
 */
export function disambiguateOptions(options, crumbOf) {
  if (!Array.isArray(options) || options.length < 2) {
    return { options: options || [], ambiguous: 0, unresolved: 0 };
  }
  const counts = new Map();
  for (const o of options) {
    const k = String(o?.label ?? "");
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let ambiguous = 0;
  const next = options.map(o => {
    const k = String(o?.label ?? "");
    if ((counts.get(k) || 0) < 2) return o;     // unique here — leave it alone
    ambiguous++;
    const chain = crumbOf(o) || "";
    return chain ? { ...o, label: `${chain}${CRUMB_SEP}${k}`, _crumb: chain } : o;
  });
  const after = new Map();
  for (const o of next) {
    const k = String(o?.label ?? "");
    after.set(k, (after.get(k) || 0) + 1);
  }
  let unresolved = 0;
  for (const c of after.values()) if (c > 1) unresolved += c;
  return { options: next, ambiguous, unresolved };
}
