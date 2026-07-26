// helpers/openOccurrenceInPanel.js
//
// Open an occurrence in a specific panel: resolve its nearest ancestor page,
// pin that page to the panel if it isn't already a tab, make it the panel's
// active page, then scroll + flash the occurrence itself.
//
// One implementation, two callers (the assistant's panel picker and the panel
// header search) — the sequence is fiddly (pin, then activate, then jump once
// the page has mounted) and was duplicated once already.
import * as CommitHelpers from "./CommitHelpers";
import { jumpToOccurrence } from "./jumpToOccurrence";
import { buildParentMap } from "./dragHitTesting";

/** Nearest role:"page" ancestor, inclusive of the occurrence itself. */
export function nearestPageOccId(occId, { occurrencesById = {}, modulesById = {} }) {
  const parentBy = buildParentMap(occurrencesById);
  let cursor = occId;
  let guard = 0;
  while (cursor && guard++ < 64) {
    const occ = occurrencesById[cursor];
    if (!occ) return null;
    const mod = modulesById[occ.moduleId || occ.targetId];
    if (mod?.role === "page") return cursor;
    cursor = parentBy[cursor] ?? occ.parentId ?? null;
  }
  return null;
}

export function openOccurrenceInPanel({
  occId, panelOccurrence, occurrencesById = {}, modulesById = {}, viewsById = {}, dispatch, socket,
}) {
  if (!occId || !panelOccurrence?.id) return { ok: false, pageOccId: null, alreadyOpen: false };

  const pageOccId = nearestPageOccId(occId, { occurrencesById, modulesById });
  if (!pageOccId) return { ok: false, pageOccId: null, alreadyOpen: false };

  const viewId = panelOccurrence.viewId
    || modulesById[panelOccurrence.moduleId || panelOccurrence.targetId]?.viewId;
  const view = viewId ? viewsById[viewId] : null;
  const alreadyOpen = view?.activeOccurrenceId === pageOccId;

  if (!alreadyOpen) {
    if (!(panelOccurrence.occurrences || []).includes(pageOccId)) {
      CommitHelpers.pinPageToPanel({
        dispatch, socket, pageOccurrenceId: pageOccId, panelOccurrenceId: panelOccurrence.id,
      });
    }
    if (view) {
      CommitHelpers.updateView({
        dispatch, socket, view: { ...view, activeOccurrenceId: pageOccId }, emit: true,
      });
    }
  }

  // jumpToOccurrence already retries after a page-switch grace window; `found`
  // is false when the target is real but filtered out of the DOM, which callers
  // surface rather than appearing to do nothing.
  const found = jumpToOccurrence(occId, { onActivatePage: () => {} });
  return { ok: true, pageOccId, alreadyOpen, found };
}
