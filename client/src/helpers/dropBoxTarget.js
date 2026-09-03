// helpers/dropBoxTarget.js
// ============================================================
// WHICH container the drop-area BOX outlines this frame — extracted because
// the rule is where the bug was, and mounting DragProvider needs the whole grid.
//
// The box exists to answer "which container am I dropping into". It went wrong
// by answering a container the drop would NOT use:
//
//   `handleDragMove` boxed the hovered element, and when that element was a
//   PARENT of containers (the Schedule's day column, hovered whenever the
//   pointer sits between two timeslots) it kept the LAST LEAF box instead —
//   deliberately, so a huge outline does not flash on every crossing. But it
//   kept it FOREVER: once the pointer left a timeslot the outline still claimed
//   it, while `_findDropTarget` resolved the day column and the drop landed
//   after the slot. User, 2026-09-03: *"i keep dropping stuff after a timeslot
//   cause my finger is underneath the timeslot but the hover says its on it."*
//
// The rule now: a leaf box may only survive while the pointer is still INSIDE
// that leaf's own rect. Outside it, the box is dropped and the insertion LINE
// alone reports the honest position between the children — a line between two
// timeslots says exactly what the drop will do, and unlike a full outline of
// the parent it cannot flash a border across the whole column as you cross.
//
// PURE: every DOM read is injected.
// ============================================================

/**
 * @param {Element|null} hoveredEl      the hovered container element (may be a parent of containers)
 * @param {Element|null} lastLeafEl     the leaf container the box was on last frame
 * @param {number} x
 * @param {number} y
 * @param {object} deps
 * @param {(el:Element)=>boolean} deps.hasNestedContainer
 * @param {(a:Element,b:Element)=>boolean} deps.contains
 * @param {(el:Element)=>boolean} deps.isConnected
 * @param {(el:Element)=>({left:number,top:number,right:number,bottom:number}|null)} deps.rectOf
 * @returns {{ el: Element|null, box: boolean, leaf: boolean }}
 *   el   — the container to compute the insertion line inside (null = hide everything)
 *   box  — draw the drop-area outline around `el`
 *   leaf — `el` is a leaf container, i.e. worth remembering as the next sticky
 */
export function resolveDropBox(hoveredEl, lastLeafEl, x, y, deps) {
  const { hasNestedContainer, contains, isConnected, rectOf } = deps;
  if (!hoveredEl) return { el: null, box: false, leaf: false };

  // A leaf container — box it, and it becomes the sticky candidate.
  if (!hasNestedContainer(hoveredEl)) return { el: hoveredEl, box: true, leaf: true };

  // A PARENT of containers. Keep the last leaf box only while the pointer is
  // genuinely still inside it: the drop resolves by hit-testing the release
  // point, so an outline the point has left is a lie about where the item goes.
  // `contains` is TRUE for self (Node.contains is), so the hovered parent must
  // be rejected as its own sticky leaf — otherwise its rect trivially holds the
  // pointer and the big outline comes straight back.
  const stickyIsLeaf = !!lastLeafEl && lastLeafEl !== hoveredEl && !hasNestedContainer(lastLeafEl);
  if (stickyIsLeaf && isConnected(lastLeafEl) && contains(hoveredEl, lastLeafEl)) {
    const r = rectOf(lastLeafEl);
    if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return { el: lastLeafEl, box: true, leaf: true };
    }
  }

  // Genuinely between the parent's children — line only, no outline.
  return { el: hoveredEl, box: false, leaf: false };
}

// The DOM-reading deps, in one place so the caller stays a three-liner.
export const domDropBoxDeps = {
  hasNestedContainer: (el) => !!el.querySelector("[data-container-id]"),
  contains: (a, b) => a.contains(b),
  isConnected: (el) => el.isConnected,
  rectOf: (el) => el.getBoundingClientRect(),
};

// ------------------------------------------------------------
// resolveHoverContainerEl
// ------------------------------------------------------------
// WHICH container a point is over — resolved the SAME WAY the drop resolves it.
//
// `handleDragMove` used to ask `getHoveredIds` (the first stacked element
// carrying `data-container-id`) while the drop asked `_findDropTarget` (the
// first REGISTERED node on the walk up — `useDroppable` registers a container's
// `.container-list` and `.container-header`, and nothing else). Two algorithms
// for one question, so they disagreed in every band where an unregistered
// element sat on top: the insert gap's 20px button and the recess ring around a
// container's list both resolve UP to the PARENT while `data-container-id` on
// the shell underneath still names the child. That disagreement IS the reported
// bug — the outline named a timeslot and the drop used the day column.
//
// Resolving both from the registered elements makes them agree by construction
// rather than by being tuned to the same geometry.
//
// PURE: `stackAt` is injected.
export function resolveHoverContainerEl(x, y, stackAt) {
  for (const el of stackAt(x, y)) {
    let node = el;
    while (node && node.parentElement) {
      const cl = node.classList;
      if (cl && (cl.contains("container-list") || cl.contains("container-header"))) {
        return node.closest("[data-container-id]") || null;
      }
      node = node.parentElement;
    }
  }
  return null;
}

