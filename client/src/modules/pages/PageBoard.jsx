// modules/pages/PageBoard.jsx
// Board page — vertical list of sortable containers.
//
// Schedule-aware rendering: when any child container carries the
// scheduleFormat field, the page enters "multi-day mode":
//   - Hide containers with scheduleFormat ∈ {"slot","due"} from the
//     page-level render (they're still multi-parented INTO each day-col
//     and render there). Prevents the slot subtree from double-rendering
//     both at the page level and inside day-cols.
//   - The day-cols carry a `Schedule Format` field with value "timeslot"
//     (≤7-day view — horizontal columns side-by-side) or "shortened"
//     (>7-day view — wrapped horizontal grid, no slots inside). Build
//     Schedule inflates/deflates each format based on $activePeriodCount,
//     so at most one mode's day-cols exist at a time.
import React, { useContext, useMemo } from "react";
import Container from "../ModuleContainer.jsx";
import { Spinner } from "../../components/ui/spinner";
import { GridActionsContext } from "../../GridActionsContext";

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
  const { fieldsById } = useContext(GridActionsContext);

  // Locate the Schedule Format field id by name. Cheap — runs once per
  // fieldsById change (fields are stable across normal usage).
  const scheduleFormatFieldId = useMemo(() => {
    if (!fieldsById) return null;
    for (const f of Object.values(fieldsById)) {
      if (f?.name === "Schedule Format") return f.id;
    }
    return null;
  }, [fieldsById]);

  const { visibleList, isMultiDay, isShortened } = useMemo(() => {
    // Day-col identity is field-based: a container with the scheduleFormat
    // field value set (any non-empty value) is a day-col. Read the value
    // off the occurrence's stamped fields. No meta markers consulted.
    const formatValueFor = (entry) => (
      scheduleFormatFieldId
        ? entry?.occurrence?.fields?.[scheduleFormatFieldId]?.value || null
        : null
    );
    const hasDayCols = containersList.some((e) => {
      const v = formatValueFor(e);
      return v && v !== "slot" && v !== "due";
    });
    if (!hasDayCols) return { visibleList: containersList, isMultiDay: false, isShortened: false };
    // Hide shared slot/Due containers at the page level — they're
    // multi-parented into each day-col and render there. Field-based:
    // scheduleFormat ∈ {"slot","due"} marks the shared shells.
    const filtered = containersList.filter((e) => {
      const v = formatValueFor(e);
      return v !== "slot" && v !== "due";
    });
    const dayCols = filtered.filter((e) => {
      const v = formatValueFor(e);
      return v && v !== "slot" && v !== "due";
    });
    // Build Schedule keeps all day-cols in one format at a time (PHASE 5
    // teardown), so the first col's format is authoritative.
    const firstFormat = dayCols.length > 0 ? formatValueFor(dayCols[0]) : null;
    const shortened = firstFormat === "shortened";
    return { visibleList: filtered, isMultiDay: dayCols.length >= 2 && !shortened, isShortened: shortened };
  }, [containersList, scheduleFormatFieldId]);

  const innerStyle = isShortened
    ? {
        position: "relative", minHeight: "100%", zIndex: 1,
        display: "flex", flexDirection: "row", flexWrap: "wrap",
        alignItems: "flex-start",
        gap: 6,
      }
    : isMultiDay
    ? {
        position: "relative", minHeight: "100%", zIndex: 1,
        display: "flex", flexDirection: "row", alignItems: "flex-start",
        gap: 12, overflowX: "auto",
      }
    : { position: "relative", minHeight: "100%", zIndex: 1 };

  const containerWrapperStyle = isShortened
    ? { flex: "1 1 140px", minWidth: 140, maxWidth: 200, minHeight: 100 }
    : isMultiDay
    ? { flex: "0 0 auto", minWidth: 280, maxWidth: 360 }
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
        outline: isOver ? "2px solid rgba(50,150,255,0.5)" : "none",
        outlineOffset: -2,
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
              panelLayoutOrientation={isMultiDay ? "horizontal" : "vertical"}
              addInstanceToContainer={addInstanceToContainer}
              dispatch={dispatch}
              socket={socket}
              gapPx={12}
            />
          );
          return containerWrapperStyle
            ? <div key={containerOcc?.id || container.id} style={containerWrapperStyle}>{card}</div>
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
