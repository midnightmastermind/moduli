// helpers/panelPresence.js — what is shown in a panel, and the onLoadInPanel /
// onUnloadFromPanel trigger decisions built on it (user, 2026-10-21:
// *"triggers we can have onLoadofOccuranceInPanel where we only trigger it if it
// loads"* · *"onLoadInPanel would take in a query to show any of these
// occurances appear in a panel"* · *"should be able to select occurances or
// modules too"*).
//
// "In a panel" is read from the DATA, not the DOM: every panel on the grid shows
// its view's active page (else its first page), and everything that page holds
// (child lists and doc embeds, all the way down) is in that panel. A row a long
// board has not mounted yet still counts — it is on the page you opened. The
// "in view" mode is the DOM-based one (hooks/usePanelLoadTriggers).
//
// All of this is PURE so it can be driven without a browser.

/** The page each panel on the grid is showing. */
export function shownPageIds({ grid, occurrencesById, viewsById, modulesById }) {
  const out = [];
  for (const panelId of grid?.occurrences || []) {
    const panel = occurrencesById?.[panelId];
    if (!panel) continue;
    const view = panel.viewId ? viewsById?.[panel.viewId] : null;
    let page = view?.activeOccurrenceId && occurrencesById[view.activeOccurrenceId] ? view.activeOccurrenceId : null;
    if (!page) {
      page = (panel.occurrences || []).find((id) => {
        const o = occurrencesById[id];
        return o && modulesById?.[o.moduleId]?.role === "page";
      }) || null;
    }
    if (page) out.push(page);
  }
  return out;
}

function embedsIn(textmap, out) {
  if (!textmap || typeof textmap !== "object") return;
  if (textmap.attrs?.occurrenceId) out.push(textmap.attrs.occurrenceId);
  for (const c of textmap.content || []) embedsIn(c, out);
}

/** Every occurrence held (child lists + doc embeds, any depth) by the given roots, roots included. */
export function heldBy(rootIds, occurrencesById) {
  const seen = new Set();
  const stack = [...rootIds];
  while (stack.length) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    const o = occurrencesById?.[id];
    if (!o) continue;
    seen.add(id);
    for (const c of o.occurrences || []) stack.push(c);
    const embeds = [];
    embedsIn(o.textmap, embeds);
    for (const c of embeds) stack.push(c);
  }
  return seen;
}

/** Everything shown in some panel right now. */
export function presentInPanels(state) {
  return heldBy(shownPageIds(state), state.occurrencesById);
}

/** The trigger objects of an operation for one of the panel events. */
export function panelTriggers(op, eventType) {
  return (op?.triggerObjects || []).filter((t) => t?.eventType === eventType);
}

/** Does an occurrence answer a trigger's query? (named occurrences, or occurrences of named modules) */
export function matchesQuery(occ, query) {
  if (!occ || !query) return false;
  if ((query.occurrenceIds || []).includes(occ.id)) return true;
  return (query.moduleIds || []).includes(occ.moduleId);
}

/** The ids among `present` that a query asks for. */
export function matchedIds(present, query, occurrencesById) {
  const out = new Set();
  if (!query || (!(query.occurrenceIds || []).length && !(query.moduleIds || []).length)) return out;
  for (const id of present) if (matchesQuery(occurrencesById[id], query)) out.add(id);
  return out;
}

/**
 * The fires one change of presence produces for one trigger. PURE.
 *   load, mode "appear"  — ids that were not matched before and are now (incl. the first look)
 *   load, mode "once"    — the first time anything matches in this app load
 *   load, mode "inView"  — decided by the DOM watcher, never here
 *   unload               — everything that matched has left every panel
 * @returns {{ fire: boolean, ids: string[] }}
 */
export function planPanelFire({ eventType, mode = "appear", prev, next, firedOnce = false }) {
  const before = prev || new Set();
  if (eventType === "onUnloadFromPanel") {
    const left = before.size > 0 && next.size === 0;
    return { fire: left, ids: left ? [...before] : [] };
  }
  if (mode === "inView") return { fire: false, ids: [] };
  if (mode === "once") {
    const fire = !firedOnce && next.size > 0;
    return { fire, ids: fire ? [...next] : [] };
  }
  const gained = [...next].filter((id) => !before.has(id));
  return { fire: gained.length > 0, ids: gained };
}
