// modules/pages/PageDisplay.jsx
// Display page — artifact viewer (markdown, image, PDF, audio, video, code, etc.)
//
// "Open in viewer" (user, 2026-10-16: "a way to go back to the file viewer after opening the file
// in a panel") reopens the viewer the file was opened from — a book row's cover-beside-the-file
// view — or, when that is not known, the file's own viewer (helpers/viewerReturn).
import React, { useState } from "react";
import { LayoutGrid } from "lucide-react";
import Artifact from "../ArtifactContent.jsx";
import { useGridActionsSelector } from "../../GridActionsContext";
import { openArtifactSpread } from "../../ui/ArtifactSpreadHost";
import { viewerOwnerFor } from "../../helpers/viewerReturn";
import { fileHasBody, FileNotesEditor, FileNotesToggle } from "../FileBody.jsx";

export default function PageDisplay({ occurrence, pageView, dispatch, socket }) {
  const getOccMap = useGridActionsSelector((s) => s.getOccMap);
  // The file's body (its notes doc) opens BESIDE the file here (user 2026-10-17).
  const fileModule = useGridActionsSelector((s) => (occurrence?.moduleId ? s.modulesById?.[occurrence.moduleId] || null : null));
  const hasBody = fileHasBody(fileModule);
  const [notesOpen, setNotesOpen] = useState(false);
  const openViewer = (e) => {
    if (!occurrence?.id) return;
    openArtifactSpread(viewerOwnerFor(occurrence.id, getOccMap?.() || null), e.currentTarget);
  };
  // A book reader has its own header row; the page's buttons join it there instead of sitting on a
  // row of their own above it (user, 2026-10-18: "merging them into one").
  const isBook = (fileModule?.kind === "pdf" || fileModule?.kind === "ebook") && !!fileModule?.fileRef;
  const btn = { padding: "2px 8px", borderRadius: 4, border: "1px solid var(--border-default)", background: "var(--input-bg)" };
  const controls = occurrence?.id ? (
    <>
      {hasBody && (
        <FileNotesToggle open={notesOpen} onToggle={() => setNotesOpen((v) => !v)} style={btn} />
      )}
      <button type="button" onClick={openViewer} aria-label="Open in viewer" title="Back to the file viewer"
        style={{ ...btn, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12,
          fontFamily: "var(--font-mono)", cursor: "pointer", color: "var(--text-primary)" }}>
        <LayoutGrid size={12} /> Open in viewer
      </button>
    </>
  ) : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
      {controls && !isBook && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, padding: "2px 6px", flexShrink: 0 }}>{controls}</div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <Artifact
          occurrence={occurrence}
          viewType={pageView?.viewType ?? "display"}
          artifactType={pageView?.artifactType ?? null}
          dispatch={dispatch}
          socket={socket}
          view={pageView}
          headerExtra={isBook ? controls : null}
        />
        </div>
        {hasBody && notesOpen && (
          <div className="file-notes-side">
            <FileNotesEditor occurrence={occurrence} dispatch={dispatch} socket={socket} onClose={() => setNotesOpen(false)} />
          </div>
        )}
      </div>
    </div>
  );
}
