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

/**
 * The panel's DOM element, resolved LAZILY (it is looked up again on every
 * retry — the panel survives the page swap, but this keeps the scope honest if
 * it ever remounts). `ModulePanel` stamps `data-panel-id` with the panel MODULE
 * id, not the occurrence id.
 */
function panelRootResolver(panelOccurrence, modulesById) {
  const panelModuleId = panelOccurrence?.moduleId || panelOccurrence?.targetId;
  if (!panelModuleId || typeof document === "undefined") return null;
  const safe = typeof CSS !== "undefined" && CSS.escape
    ? CSS.escape(String(panelModuleId)) : String(panelModuleId);
  return () => document.querySelector(`[data-panel-id="${safe}"]`);
}

export function openOccurrenceInPanel({
  occId, panelOccurrence, occurrencesById = {}, modulesById = {}, viewsById = {}, dispatch, socket,
  onMissing,
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

  // Scoped to THIS panel: the same occurrence is often mounted in another cell
  // too (a page pinned twice, a copy-link, a feed copy), and an unscoped lookup
  // highlights whichever the document happens to hold first — so the search
  // opened the item here and flashed it over there (user 2026-07-27).
  // When the page was already open there is nothing to wait for, so a miss
  // means "filtered out" and is reported synchronously via `found`. When we
  // just pinned/activated the page, its subtree needs a few frames to mount:
  // poll, and report a miss through `onMissing` instead.
  const root = panelRootResolver(panelOccurrence, modulesById);
  const found = jumpToOccurrence(occId, {
    root,
    retries: alreadyOpen ? 0 : 16,
    retryMs: 120,
    onMissing,
  });
  return { ok: true, pageOccId, alreadyOpen, found };
}
