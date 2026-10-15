// ui/commandCenter/CategoryColumnDnd.jsx
//
// Drag a field / operation within its category column, or into another column
// (Fields tab, Operations tab). Columns and rows are Pragmatic drop targets — the
// columns used to listen for native HTML5 drop events, which a Pragmatic drag of the
// chip never delivered there, so nothing could be reordered or moved (user,
// 2026-10-15). The order is stored as `columnOrder` (helpers/categoryColumnSort).

import React, { useEffect, useRef, useState } from "react";
import { dropTargetForElements, monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { attachClosestEdge, extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { planColumnMove, dropIndex } from "../../helpers/categoryColumnSort";

/** A column as a drop target (a drop on it, not on a row, lands at the end). */
export function useColumnDropTarget(ref, { kind, colKey }) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    return dropTargetForElements({
      element: el,
      canDrop: ({ source }) => source.data?.type === kind,
      getData: () => ({ ccColKey: colKey }),
    });
  }, [ref, kind, colKey]);
}

/** One row in a column; the drop lands above or below it by the closest edge. */
export function SortableRow({ kind, colKey, itemId, indicator, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    return dropTargetForElements({
      element: el,
      canDrop: ({ source }) => source.data?.type === kind,
      getData: ({ input, element }) => attachClosestEdge(
        { ccColKey: colKey, ccItemId: itemId },
        { input, element, allowedEdges: ["top", "bottom"] },
      ),
    });
  }, [kind, colKey, itemId]);
  const edge = indicator?.itemId === itemId ? indicator.edge : null;
  return (
    <div ref={ref} data-cc-row={itemId} style={{ position: "relative" }}>
      {edge && (
        <div style={{ position: "absolute", left: 0, right: 0, height: 2, borderRadius: 1, background: "rgb(50,150,255)",
          [edge === "top" ? "top" : "bottom"]: -2, pointerEvents: "none" }} />
      )}
      {children}
    </div>
  );
}

/**
 * Watches drags of `kind` and calls `onMove(draggedId, colKey, writes)` on a drop.
 * `getColumn(colKey)` returns that column's items in display order (read at drop time).
 * Returns `{ overColumn, indicator }` for drawing the drop feedback.
 */
export function useCategoryDropMonitor({ kind, getColumn, onMove }) {
  const [overColumn, setOverColumn] = useState(null);
  const [indicator, setIndicator] = useState(null);
  const latest = useRef({ getColumn, onMove });
  latest.current = { getColumn, onMove };
  useEffect(() => monitorForElements({
    canMonitor: ({ source }) => source.data?.type === kind,
    onDrag: ({ location }) => {
      const t = location.current.dropTargets.find((x) => x.data?.ccColKey !== undefined);
      setOverColumn(t ? t.data.ccColKey : null);
      setIndicator(t?.data?.ccItemId ? { itemId: t.data.ccItemId, edge: extractClosestEdge(t.data) } : null);
    },
    onDrop: ({ source, location }) => {
      setOverColumn(null); setIndicator(null);
      const t = location.current.dropTargets.find((x) => x.data?.ccColKey !== undefined);
      const draggedId = source.data?.id;
      if (!t || !draggedId) return;
      const colKey = t.data.ccColKey;
      const column = latest.current.getColumn(colKey) || [];
      const index = dropIndex(column, t.data.ccItemId, extractClosestEdge(t.data));
      latest.current.onMove(draggedId, colKey, planColumnMove({ column, draggedId, index }));
    },
  }), [kind]);
  return { overColumn, indicator };
}

/** A column box that is a drop target. */
export function DropColumn({ kind, colKey, style, children }) {
  const ref = useRef(null);
  useColumnDropTarget(ref, { kind, colKey });
  return <div ref={ref} data-cc-col={colKey} style={style}>{children}</div>;
}
