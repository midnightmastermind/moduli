// modules/pages/PageDisplay.jsx
// Display page — artifact viewer (markdown, image, PDF, audio, video, code, etc.)
//
// "Open in viewer" (user, 2026-10-16: "a way to go back to the file viewer after opening the file
// in a panel") reopens the viewer the file was opened from — a book row's cover-beside-the-file
// view — or, when that is not known, the file's own viewer (helpers/viewerReturn).
import React from "react";
import { LayoutGrid } from "lucide-react";
import Artifact from "../ArtifactContent.jsx";
import { useGridActionsSelector } from "../../GridActionsContext";
import { openArtifactSpread } from "../../ui/ArtifactSpreadHost";
import { viewerOwnerFor } from "../../helpers/viewerReturn";

export default function PageDisplay({ occurrence, pageView, dispatch, socket }) {
  const getOccMap = useGridActionsSelector((s) => s.getOccMap);
  const openViewer = (e) => {
    if (!occurrence?.id) return;
    openArtifactSpread(viewerOwnerFor(occurrence.id, getOccMap?.() || null), e.currentTarget);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
      {occurrence?.id && (
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "2px 6px", flexShrink: 0 }}>
          <button type="button" onClick={openViewer} aria-label="Open in viewer" title="Back to the file viewer"
            style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", fontSize: 12,
              fontFamily: "var(--font-mono)", cursor: "pointer", borderRadius: 4, border: "1px solid var(--border-default)",
              background: "var(--input-bg)", color: "var(--text-primary)" }}>
            <LayoutGrid size={12} /> Open in viewer
          </button>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Artifact
          occurrence={occurrence}
          viewType={pageView?.viewType ?? "display"}
          artifactType={pageView?.artifactType ?? null}
          dispatch={dispatch}
          socket={socket}
          view={pageView}
        />
      </div>
    </div>
  );
}
