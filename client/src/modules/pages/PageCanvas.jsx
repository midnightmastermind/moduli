// modules/pages/PageCanvas.jsx
// Canvas page — the page occurrence IS the canvas container.
// Delegates directly to ModuleContainer with the page occurrence as override.
import React from "react";
import Container from "../ModuleContainer.jsx";

export default function PageCanvas({ pageModule, occurrence, panelId, addInstanceToContainer, dispatch, socket }) {
  return (
    <Container
      module={pageModule}
      occurrenceOverride={occurrence}
      panelId={panelId}
      addInstanceToContainer={addInstanceToContainer}
      dispatch={dispatch}
      socket={socket}
    />
  );
}
