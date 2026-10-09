// helpers/pageChildPairs.js
//
// A page's children paired with THEIR placements, in page order. Walk the page's child OCCURRENCES, not its
// child modules: a page can hold several placements of one module (a container copy-dragged in, a template
// applied twice, a slot module placed once per day), and resolving one placement per module rendered the first
// placement once for every copy — the rest were unreachable (2026-10-09). Per-day placements still show only
// the one the page's filter admits, because each placement is checked on its own.
export function pairPageChildren(childOccIds, occurrencesById, modulesById, isVisible) {
  const pairs = [];
  for (const occId of childOccIds || []) {
    const occ = occurrencesById?.[occId];
    if (!occ) continue;
    const container = modulesById?.[occ.moduleId];
    if (!container) continue;
    if (!isVisible(occ)) continue;
    pairs.push({ container, occurrence: occ });
  }
  return pairs;
}
