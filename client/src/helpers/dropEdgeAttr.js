// helpers/dropEdgeAttr.js
//
// The drop-edge indicator, written to the DOM instead of React state.
//
// `isOver`/`closestEdge` exist to draw four 2px bars at an element's edges, and
// as React state one hover crossing re-renders the whole component — for
// `ModuleContainer` that is 1,900 lines plus every row and field inside it.
// Measured on the user's tablet during ONE drag (2026-09-01): 2,004-3,383
// container renders and 225-248 instance renders.
//
// Extracted so it can be tested against a real element. Left inline in the hook
// it was only reachable through an internal ref, and the test that "covered" it
// asserted `isOver === false` — which was true before the change too.

/** Hovered at all. Clearing it also clears the edge: a stale `data-drop-edge`
 *  would leave a bar lit on an element the finger has already left. */
export function setDropOver(el, on) {
  if (!el?.setAttribute) return;
  if (on) el.setAttribute("data-drop-over", "");
  else { el.removeAttribute("data-drop-over"); el.removeAttribute("data-drop-edge"); }
}

/** Which edge the pointer is nearest. `null` removes it. */
export function setDropEdge(el, edge) {
  if (!el?.setAttribute) return;
  if (edge) el.setAttribute("data-drop-edge", String(edge));
  else el.removeAttribute("data-drop-edge");
}
