// helpers/pressPanel.js — which panel a press happened in, for the operation the press runs.
//
// A button's operation can change what THAT panel shows (user, 2026-10-26: an artist's "Albums" button opens the
// Albums board, filtered to the artist, "the one we pressed the button in"). The press knows its element; a panel
// marks its DOM with `data-panel-id` (the panel MODULE id). From that: the panel's occurrence on this grid, its view
// (what UPDATE_VIEW changes) and the page it shows now.

/** `{ panelOccurrenceId, panelViewId, panelPageId }` for the panel `el` sits in, or {} outside any panel. Pure apart
 *  from reading the element's ancestors. */
export function pressPanel(el, state) {
  const moduleId = el?.closest?.("[data-panel-id]")?.getAttribute?.("data-panel-id");
  if (!moduleId || !state) return {};
  const onGrid = new Set(state.grid?.occurrences || []);
  const occs = state.occurrences || [];
  const occ = occs.find((o) => o?.moduleId === moduleId && onGrid.has(o.id)) || occs.find((o) => o?.moduleId === moduleId && o.viewId);
  if (!occ) return {};
  const view = occ.viewId ? (state.views || []).find((v) => v?.id === occ.viewId) : null;
  return {
    panelOccurrenceId: occ.id,
    panelViewId: occ.viewId || null,
    panelPageId: view?.activeOccurrenceId || null,
  };
}
