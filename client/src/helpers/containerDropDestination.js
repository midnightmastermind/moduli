// helpers/containerDropDestination.js
//
// WHERE A CONTAINER DROP LANDS. A container dropped on the edge of another
// container lands BESIDE it, in the list that holds it — the page for a
// top-level container, the parent container for a nested one. The source side
// already follows the same rule ("whoever lists it", nestedContainerDragOut);
// before this the destination was always the PAGE, so a drop beside a nested
// container found no index and did nothing.
//
// Pure: takes the hovered container's occurrence id, the dragged one's, the
// occurrence map and the list to fall back on (the page) and returns
// `{ list, hoveredIndex }`, or `{ refused: true }` when the drop would put the
// dragged container inside its own subtree.

export function containerDropDestination({ hoveredOccId, draggedOccId, occurrencesById, fallback }) {
  const occs = occurrencesById || {};
  const listerOf = (id) => Object.values(occs).find((o) => Array.isArray(o?.occurrences) && o.occurrences.includes(id)) || null;

  if (!hoveredOccId) return { list: fallback, hoveredIndex: -1 };
  // A container can be listed by several parents (a shared Todo, the Emotions
  // Wheel). Prefer the list the drop is happening in (the page), then the
  // container's own home, then whoever lists it.
  const lists = (o) => Array.isArray(o?.occurrences) && o.occurrences.includes(hoveredOccId);
  const home = occs[occs[hoveredOccId]?.parentId];
  const list = (lists(fallback) && fallback) || (lists(home) && home) || listerOf(hoveredOccId) || fallback;
  if (!list) return { list: fallback, hoveredIndex: -1 };

  // A container cannot be placed inside itself or anything below it. Walk up
  // from the destination list; reaching the dragged container means it is ours.
  if (draggedOccId && hoveredOccId !== draggedOccId) {
    const seen = new Set();
    for (let cur = list; cur && !seen.has(cur.id); cur = listerOf(cur.id)) {
      if (cur.id === draggedOccId) return { refused: true };
      seen.add(cur.id);
    }
  }

  return { list, hoveredIndex: (list.occurrences || []).indexOf(hoveredOccId) };
}
