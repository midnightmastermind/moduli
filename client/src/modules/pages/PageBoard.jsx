// modules/pages/PageBoard.jsx
//
// Generic board page renderer. Reads layout shape entirely from the
// layout cascade — `mode` / `columns` / `childGap` / `hideChildIds` —
// and applies it. NO domain knowledge of schedule, no field sniffing,
// no kind-specific branches. Any op (or seed) that wants a custom
// layout writes `meta.layoutCascade` on the page occurrence and this
// renderer reflects it.
//
// Cascade properties consumed:
//   mode          "stack" (default) | "flex-row" | "grid"
//   columns       integer — used when mode === "grid"
//   childGap      gap between children in px
//   hideChildIds  array of occurrence IDs to skip rendering at this
//                 level (children may still appear elsewhere via
//                 multi-parenting)
import React, { useMemo } from "react";
import Container from "../ModuleContainer.jsx";
import { Spinner } from "../../components/ui/spinner";
import { useGridActionsSelector, useGridActionsSelectorShallow } from "../../GridActionsContext";
import { resolveEffectiveLayout } from "../../helpers/layoutCascade";

// Resolve a sortable numeric key from a child occurrence's field value.
// Date-like strings → epoch ms; plain numbers → the number; everything
// else (missing / non-numeric) → null (left unsorted by the caller).
function childSortKey(occurrence, fieldId) {
  const raw = occurrence?.fields?.[fieldId]?.value;
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return raw;
  const t = Date.parse(raw);
  if (!Number.isNaN(t)) return t;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export default function PageBoard({
  occurrence,
  containersList,
  panelId,
  addInstanceToContainer,
  dispatch,
  socket,
  dropRef,
  isOver,
  isMobileLayout,
  fullStateLoaded,
}) {
  // occurrencesById rebuilds on every occurrence write — subscribe only to
  // the ancestor chain (the reactive dep of the layout-cascade walk) and read
  // the full map at compute time via the non-subscribing getter.
  const modulesById = useGridActionsSelector(s => s.modulesById);
  const grid = useGridActionsSelector(s => s.grid);
  const getOccMap = useGridActionsSelector(s => s.getOccMap || (() => s.occurrencesById || {}));
  const ancestorChain = useGridActionsSelectorShallow(s => {
    const out = [];
    let cursor = occurrence?.id;
    let guard = 0;
    while (cursor && guard++ < 64) {
      const pid = s.parentByChildId?.[cursor];
      const parent = pid ? s.occurrencesById?.[pid] : null;
      if (!parent) break;
      out.push(parent);
      cursor = pid;
    }
    return out;
  });

  const layout = useMemo(
    // eslint-disable-next-line react-hooks/exhaustive-deps
    () => resolveEffectiveLayout({ occurrence, occurrencesById: getOccMap(), modulesById, grid }),
    [occurrence, ancestorChain, modulesById, grid, getOccMap]
  );

  const mode = layout?.mode || "stack";
  const columns = Math.max(1, Number(layout?.columns) || 1);
  const childGap = Number.isFinite(layout?.childGap) ? layout.childGap : 12;
  const hideSet = useMemo(() => new Set(layout?.hideChildIds || []), [layout?.hideChildIds]);
  // Optional cascade rule: order visible children by a value/date field on each
  // child occurrence (e.g. schedule day-columns by their date). Generic — this
  // renderer knows nothing about "schedule"; an op/seed sets the field id.
  const sortField = layout?.sortChildrenByField || null;
  // Cap a child's height and let it scroll inside itself. Without this a tall
  // child grows the whole surface, and anything that changes height on hover
  // (an empty add-pocket revealing its label) shoves everything below it —
  // which is what made the hover target slip out from under the pointer.
  const childMaxHeight = Number.isFinite(layout?.childMaxHeight) && layout.childMaxHeight > 0
    ? layout.childMaxHeight
    : null;

  const visibleList = useMemo(() => {
    const filtered = containersList.filter((e) => !hideSet.has(e?.occurrence?.id));
    if (!sortField) return filtered;
    // Stable sort: keyed children ascend by their field value (dates →
    // timestamp, numbers → number); unkeyed children keep their original
    // relative order below the keyed ones.
    return filtered
      .map((e, i) => ({ e, i, k: childSortKey(e?.occurrence, sortField) }))
      .sort((a, b) => {
        if (a.k == null && b.k == null) return a.i - b.i;
        if (a.k == null) return 1;
        if (b.k == null) return -1;
        if (a.k === b.k) return a.i - b.i;
        return a.k - b.k;
      })
      .map((x) => x.e);
  }, [containersList, hideSet, sortField]);

  const innerStyle =
    mode === "grid"
      ? {
          position: "relative", minHeight: "100%", zIndex: 1,
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          alignItems: "stretch",
          gap: childGap,
        }
      : mode === "flex-row"
      ? {
          position: "relative", minHeight: "100%", zIndex: 1,
          display: "flex", flexDirection: "row", alignItems: "flex-start",
          gap: childGap, width: "max-content",
        }
      : { position: "relative", minHeight: "100%", zIndex: 1 };

  const capStyle = childMaxHeight
    ? { maxHeight: childMaxHeight, overflowY: "auto", overscrollBehavior: "contain" }
    : null;
  // Column width is cascade-driven so a board can be widened from its own
  // header menu; 280/360 stays the default (what the Schedule has always used).
  const colMinW = Number.isFinite(layout?.childMinWidth) && layout.childMinWidth > 0 ? layout.childMinWidth : 280;
  const colMaxW = Number.isFinite(layout?.childMaxWidth) && layout.childMaxWidth > 0 ? layout.childMaxWidth : 360;
  const childWrapperStyle =
    mode === "flex-row" ? { flex: "0 0 auto", minWidth: colMinW, maxWidth: colMaxW, ...capStyle }
      : mode === "grid" ? { minWidth: 0, minHeight: 100, ...capStyle }
      : capStyle || undefined;

  return (
    <div
      ref={dropRef}
      className={mode === "flex-row" ? "page-board-hscroll" : undefined}
      style={{
        flex: 1, minHeight: 0,
        overflowY: "auto",
        overflowX: mode === "flex-row" ? "auto" : undefined,
        WebkitOverflowScrolling: "touch",
        overscrollBehavior: "contain",
        padding: isMobileLayout ? "6px 6px 80px 6px" : "0px 5px 80px 5px",
        position: "relative",
        // Page-level isOver outline removed — it toggled via React state and
        // sputtered. The drop area is now shown by DragProvider's direct-DOM
        // drop-area box around the hovered container (zero re-render, stable).
      }}
    >
      <div style={innerStyle}>
        {visibleList.map(({ container, occurrence: containerOcc }) => {
          const card = (
            <Container
              key={containerOcc?.id || container.id}
              module={container}
              occurrenceOverride={containerOcc}
              panelId={panelId}
              pageOccurrenceId={occurrence.id}
              panelLayoutOrientation={mode === "flex-row" ? "horizontal" : "vertical"}
              addInstanceToContainer={addInstanceToContainer}
              dispatch={dispatch}
              socket={socket}
              gapPx={childGap}
            />
          );
          const wrapStyle = childWrapperStyle;
          return wrapStyle
            ? <div key={containerOcc?.id || container.id} style={wrapStyle}>{card}</div>
            : card;
        })}
        {visibleList.length === 0 && !fullStateLoaded && (occurrence.occurrences?.length > 0) && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "32px 0", opacity: 0.5 }}>
            <Spinner size="sm" />
          </div>
        )}
        {visibleList.length === 0 && (fullStateLoaded || !occurrence.occurrences?.length) && (
          <div className="text-xs text-muted-foreground text-center empty-placeholder">
            Drop containers here
          </div>
        )}
      </div>
    </div>
  );
}
