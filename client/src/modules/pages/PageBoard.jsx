// modules/pages/PageBoard.jsx
// Board page — vertical list of sortable containers.
import React, { useContext } from "react";
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
  const { occurrencesById } = useContext(GridActionsContext);
  const childOccIds = occurrence.occurrences || [];

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
      <div style={{ position: "relative", minHeight: "100%", zIndex: 1 }}>
        {containersList.map((container) => {
          const containerOccId = childOccIds.find(occId => occurrencesById[occId]?.targetId === container.id);
          const containerOcc = containerOccId ? occurrencesById[containerOccId] : null;
          return (
            <Container
              key={containerOccId || container.id}
              module={container}
              occurrenceOverride={containerOcc}
              panelId={panelId}
              pageOccurrenceId={occurrence.id}
              panelLayoutOrientation="vertical"
              addInstanceToContainer={addInstanceToContainer}
              dispatch={dispatch}
              socket={socket}
              gapPx={12}
            />
          );
        })}
        {containersList.length === 0 && !fullStateLoaded && (occurrence.occurrences?.length > 0) && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "32px 0", opacity: 0.5 }}>
            <Spinner size="sm" />
          </div>
        )}
        {containersList.length === 0 && (fullStateLoaded || !occurrence.occurrences?.length) && (
          <div className="text-xs text-muted-foreground text-center empty-placeholder">
            Drop containers here
          </div>
        )}
      </div>
    </div>
  );
}
