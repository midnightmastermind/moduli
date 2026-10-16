// ui/SpreadTileOpenInPanel.jsx
//
// A viewer tile's "Open in panel" (user, 2026-10-16): the file — image, video, book, pdf,
// bookmark — opens as its own page in the panel the viewer came from, and the viewer closes,
// since that panel is under it. Beside `SpreadTileMaximize`; renders NOTHING outside the viewer,
// and nothing for a tile that is not a file (a row has no page of its own to open).
import React from "react";
import { PanelTop } from "lucide-react";
import { useSpreadHost } from "../helpers/spreadDock";
import { useOpenArtifactInPanel } from "../hooks/useOpenArtifactInPanel";
import { rememberViewerOrigin } from "../helpers/viewerReturn";

export default function SpreadTileOpenInPanel({ occurrenceId, isFile }) {
  const host = useSpreadHost();
  const open = useOpenArtifactInPanel();
  if (!host || !occurrenceId || !isFile) return null;
  return (
    <button
      type="button"
      className="spread-tile-maximize spread-tile-open-panel"
      aria-label="Open in panel"
      title="Open in panel"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        const res = open(occurrenceId, { fromPanelModuleId: host.originPanelModuleId });
        if (res?.ok) { rememberViewerOrigin(occurrenceId, host.ownerOccurrenceId); host.close(); }
      }}
    >
      <PanelTop style={{ width: 13, height: 13 }} />
    </button>
  );
}
