// helpers/mosaicTouch.js — a panel dragged by touch (and in the headset, where the controller is a touch) can be
// rearranged in a mosaic grid.
//
// The mosaic's panes take panel drops through Pragmatic (the browser's own drag events). A touch drag never fires
// those — it runs the app's own path (helpers/dragSystem) — so in the headset a panel could not be moved at all (user,
// 2026-10-26: "i also cant rearrange mosaic panels in the full grid window on vr"). The mounted mosaic registers a
// handler here; the touch path asks it on every hover step and at the release, before its own targets.

let handler = null;

/** GridMosaic: `{ hover(x, y, draggedId), drop(x, y, draggedId), clear() }`. Returns the unregister. */
export function setMosaicTouchHandler(h) {
  handler = h;
  return () => { if (handler === h) handler = null; };
}

const draggedPanelId = (payload) => (payload?.type === "panel" ? (payload.data?._occurrenceId || null) : null);

/** A touch drag moved: true when the mosaic shows where a panel would land. */
export function mosaicTouchHover(x, y, payload) {
  const id = draggedPanelId(payload);
  if (!handler || !id) return false;
  return !!handler.hover(x, y, id);
}

/** A touch drag was let go: true when the mosaic took the panel. */
export function mosaicTouchDrop(x, y, payload) {
  const id = draggedPanelId(payload);
  if (!handler || !id) return false;
  return !!handler.drop(x, y, id);
}

export function mosaicTouchClear() { handler?.clear?.(); }

/** The edge of `rect` nearest (x, y): what a pane drop splits along. Pure. */
export function nearestEdge(rect, x, y) {
  const d = { top: y - rect.top, bottom: rect.bottom - y, left: x - rect.left, right: rect.right - x };
  return Object.entries(d).sort((a, b) => a[1] - b[1])[0][0];
}
