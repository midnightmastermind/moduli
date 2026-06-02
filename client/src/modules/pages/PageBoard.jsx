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
import React, { useContext, useMemo } from "react";
import Container from "../ModuleContainer.jsx";
import { Spinner } from "../../components/ui/spinner";
import { useGridActionsSelector } from "../../GridActionsContext";
import { resolveEffectiveLayout } from "../../helpers/layoutCascade";

export default function PageBoard({
  occurrence,
  containersList,
  panelId,
  addInstanceToContainer,
  dispatch,
  socket,
  dropRef,
  isOver,
  isMobile,
  fullStateLoaded,
}) {
  const occurrencesById = useGridActionsSelector(s => s.occurrencesById);
  const modulesById = useGridActionsSelector(s => s.modulesById);
  const grid = useGridActionsSelector(s => s.grid);

  const layout = useMemo(
    () => resolveEffectiveLayout({ occurrence, occurrencesById, modulesById, grid }),
    [occurrence, occurrencesById, modulesById, grid]
  );

  const mode = layout?.mode || "stack";
  const columns = Math.max(1, Number(layout?.columns) || 1);
  const childGap = Number.isFinite(layout?.childGap) ? layout.childGap : 12;
  const hideSet = useMemo(() => new Set(layout?.hideChildIds || []), [layout?.hideChildIds]);

  const visibleList = useMemo(
    () => containersList.filter((e) => !hideSet.has(e?.occurrence?.id)),
    [containersList, hideSet]
  );

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
          gap: childGap, overflowX: "auto",
        }
      : { position: "relative", minHeight: "100%", zIndex: 1 };

  const childWrapperStyle =
    mode === "flex-row" ? { flex: "0 0 auto", minWidth: 280, maxWidth: 360 }
      : mode === "grid" ? { minWidth: 0, minHeight: 100 }
      : undefined;

  return (
    <div
      ref={dropRef}
      style={{
        flex: 1, minHeight: 0,
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
        overscrollBehavior: "contain",
        padding: isMobile ? "6px 6px 80px 6px" : "0px 5px 80px 5px",
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
          return childWrapperStyle
            ? <div key={containerOcc?.id || container.id} style={childWrapperStyle}>{card}</div>
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
