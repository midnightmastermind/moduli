// helpers/pageTwin.js — a page that holds just one section of its own name reads as ONE thing (search already treats
// it so: occurrenceSearch `sameAsPage`). Renaming either renames both, or the shelf (which shows the page) kept the old
// name after the section's title was changed (user, 2026-10-26: "renaming a page isnt reflecting back onto the book";
// measured: section "bo 1" -> "bo burnham", its board page still "bo 1").
const shown = (occ, mod) => (typeof occ?.label === "string" && occ.label.trim() ? occ.label : mod?.label || "");

/**
 * The twin of `occ` (a page's only child section, or the page holding only `occ`) when the two show the same name
 * now, or null. `getOcc` / `getMod` look rows up by id. Pure.
 */
export function pageTwin(occ, { getOcc, getMod }) {
  if (!occ?.id) return null;
  const mod = getMod(occ.moduleId);
  if (!mod) return null;
  let twin = null;
  if (mod.role === "page") {
    const kids = occ.occurrences || [];
    const child = kids.length === 1 ? getOcc(kids[0]) : null;
    if (child && getMod(child.moduleId)?.role === "container") twin = child;
  } else if (mod.role === "container") {
    const parent = occ.parentId ? getOcc(occ.parentId) : null;
    if (parent && getMod(parent.moduleId)?.role === "page" && (parent.occurrences || []).length === 1 && parent.occurrences[0] === occ.id) twin = parent;
  }
  if (!twin) return null;
  const twinMod = getMod(twin.moduleId);
  return shown(twin, twinMod) === shown(occ, mod) ? { occurrence: twin, module: twinMod } : null;
}

/** What renaming the twin to `label` writes: its placement's own label when it has one, else its module's. Pure. */
export function twinRenameWrite(twin, label) {
  if (typeof twin.occurrence?.label === "string" && twin.occurrence.label.trim()) return { occurrence: { id: twin.occurrence.id, label } };
  return { module: { ...twin.module, label } };
}
