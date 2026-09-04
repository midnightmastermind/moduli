// One answer to "where do I put this?" — shared by the Pomodoro destination
// picker and the browser's "save as bookmark" picker.
//
// It lives here rather than in either component because both ask the SAME
// question, and two walks over the occurrence tree is exactly how the two
// pickers would quietly stop listing the same places.

/**
 * Every container occurrence, labelled with its `Page › Container` chain.
 *
 * Pure so the walk is testable — mounting either caller needs the whole grid
 * store, and this is 40 lines of ancestor walking with a cycle guard and a
 * depth cap that had no coverage at all.
 *
 * The crumb walk prefers the reverse map built from `occurrences[]` over the
 * child's own `parentId`, because placement on this grid IS the parent's child
 * list — a row can be listed by one occurrence while `parentId` names another.
 * It stops at the first `page` ancestor, guards against a cycle with `seen`,
 * and caps at 8 so a malformed chain cannot hang the toolbar.
 */
export function buildContainerCrumbOptions(occurrencesById, modulesById) {
  const occMap = occurrencesById || {};
  // Reverse parent map: childOccId → parentOccId via occurrences[].
  const parentByChild = {};
  for (const occ of Object.values(occMap)) {
    for (const childId of occ?.occurrences || []) parentByChild[childId] = occ.id;
  }
  const labelFor = (occ) => {
    const mod = modulesById?.[occ.moduleId];
    return mod?.label || occ.label || occ.id.slice(0, 6);
  };
  const out = [];
  for (const occ of Object.values(occMap)) {
    const mod = modulesById?.[occ.moduleId];
    if (!mod || mod.role !== "container") continue;
    // Walk up to find page-chain crumbs.
    const crumbs = [];
    let cur = parentByChild[occ.id] || occ.parentId;
    const seen = new Set();
    let depth = 0;
    while (cur && !seen.has(cur) && depth++ < 8) {
      seen.add(cur);
      const a = occMap[cur];
      if (!a) break;
      const am = modulesById?.[a.moduleId];
      if (am?.label) crumbs.unshift(am.label);
      if (am?.role === "page") break;
      cur = parentByChild[cur] || a.parentId;
    }
    const chain = crumbs.join(" › ");
    const label = labelFor(occ);
    out.push({ id: occ.id, label: chain ? `${chain} › ${label}` : label });
  }
  out.sort((a, b) => (a.label || "").localeCompare(b.label || ""));
  return out;
}
