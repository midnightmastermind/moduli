// helpers/filterFollow.js
//
// A PARENT'S FILTER CHANGE CARRIES DOWN TO THE PAGES THAT PINNED THEIR OWN.
//
// User, 2026-09-26: "if a field is inherited and changed by a parent, it
// should switch to that (just for that change) on the children subscribed. So
// if i have a date set to today on the schedule page, and switch it to
// tomorrow in the top toolbar, it should change on the schedule page as well.
// if i change it on the schedule page again (then it overwrites the top
// toolbars." — for FILTERS only, not styles.
//
// So the nearest level still wins at READ time (the cascade is unchanged); what
// changes is WRITE time: a toolbar change also rewrites the same filter on every
// page that holds its own value for it. A later change on the page overrides
// again, exactly as before.
//
// SCOPED TO PAGES, deliberately. A Schedule day column is a container carrying
// its own date as structure — the build op pins each column to its day — and
// following the toolbar would put every column on the same day. And an override
// that is present but null means "this filter is OFF here": the user switched
// it off, and following would switch it back on.

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * PURE. The page overrides to rewrite after the grid's filter values changed.
 * @param {Object} changed          { [fieldId]: newValue } — what the toolbar just set
 * @param {Object} occurrencesById
 * @param {Object} modulesById
 * @returns {{ id: string, filterOverride: Object }[]}
 */
export function planFollowingPages(changed, occurrencesById, modulesById) {
  const out = [];
  const keys = Object.keys(changed || {});
  if (!keys.length) return out;
  for (const occ of Object.values(occurrencesById || {})) {
    const fo = occ?.filterOverride;
    if (!fo || typeof fo !== "object") continue;
    if (modulesById?.[occ.moduleId]?.role !== "page") continue;
    let next = null;
    for (const fid of keys) {
      if (!Object.prototype.hasOwnProperty.call(fo, fid)) continue;   // inherits already
      if (fo[fid] == null) continue;                                   // switched off here
      if (same(fo[fid], changed[fid])) continue;
      next = next || { ...fo };
      next[fid] = changed[fid];
    }
    if (next) out.push({ id: occ.id, filterOverride: next });
  }
  return out;
}
