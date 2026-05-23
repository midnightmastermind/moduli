// ui/commandCenter/FilesTab.jsx
// FilesTab + ArtifactPill + fileIcon + formatBytes

import React, { useState, useMemo, useContext, useEffect, useRef } from "react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { GripVertical, Upload } from "lucide-react";

import { GridActionsContext } from "../../GridActionsContext";
import { createModuleAction, createOccurrenceAction } from "../../state/actions";

const MIME_EXT_ICONS = { md: "📝", txt: "📄", pdf: "📕", png: "🖼️", jpg: "🖼️",
  jpeg: "🖼️", gif: "🖼️", mp4: "🎬", mp3: "🎵", json: "🗂️" };

export function fileIcon(name, isDirectory) {
  if (isDirectory) return "📁";
  const ext = name.split(".").pop()?.toLowerCase();
  return MIME_EXT_ICONS[ext] || "📄";
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function ArtifactPill({ module: mod }) {
  const ref = useRef(null);
  const ext = (mod.fileRef || mod.label || "").split(".").pop()?.toLowerCase();
  const icon = MIME_EXT_ICONS[ext] || "📄";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return draggable({
      element: el,
      getInitialData: () => ({
        type: "module",
        id: mod.id,
        data: { ...mod, defaultDragMode: "copy" },
        role: "artifact",
        defaultDragMode: "copy",
        sourceType: "command-center",
      }),
    });
  }, [mod]);

  return (
    <div
      ref={ref}
      style={{
        display: "flex", alignItems: "center", gap: 7,
        padding: "4px 8px", borderRadius: 5,
        background: "var(--input-bg)",
        border: "1px solid var(--border-subtle)",
        cursor: "grab", userSelect: "none",
      }}
    >
      <GripVertical style={{ width: 10, height: 10, color: "var(--text-faint)", flexShrink: 0 }} />
      <span style={{ flexShrink: 0 }}>{icon}</span>
      <span style={{
        flex: 1, fontSize: 11, fontFamily: "monospace",
        color: "var(--text-primary)", overflow: "hidden",
        textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {mod.label || mod.fileRef || mod.id}
      </span>
    </div>
  );
}

export function FilesTab() {
  const { state, modulesById, dispatch, socket } = useContext(GridActionsContext);
  const gridId = state?.gridId;
  const userId = state?.userId;
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [dropActive, setDropActive] = useState(false);

  const artifacts = useMemo(
    () => Object.values(modulesById || {}).filter(m => m.role === "artifact"),
    [modulesById]
  );

  async function uploadFile(file) {
    if (!file || !userId || !gridId) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("userId", userId);
      form.append("gridId", gridId);
      const res = await fetch("/api/artifacts/upload", { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (data.module) dispatch(createModuleAction(data.module));
      if (data.occurrence) dispatch(createOccurrenceAction(data.occurrence));
    } catch (err) {
      console.error("Artifact upload failed:", err);
    } finally {
      setUploading(false);
    }
  }

  function handleFileInput(e) {
    const files = Array.from(e.target.files || []);
    for (const f of files) uploadFile(f);
    e.target.value = "";
  }

  function handleNativeDrop(e) {
    e.preventDefault();
    setDropActive(false);
    const files = Array.from(e.dataTransfer?.files || []);
    for (const f of files) uploadFile(f);
  }

  const dropZoneStyle = {
    border: `1.5px dashed ${dropActive ? "rgba(100,160,255,0.7)" : "var(--border-default)"}`,
    borderRadius: 7,
    padding: "10px 12px",
    background: dropActive ? "rgba(100,160,255,0.06)" : "transparent",
    transition: "all 0.15s",
  };

  return (
    <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Header toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
        <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-faint)", flex: 1 }}>
          Drag artifacts to the grid to place them. {artifacts.length > 0 && `${artifacts.length} file${artifacts.length === 1 ? "" : "s"}`}
        </span>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "3px 8px", borderRadius: 4, fontSize: 10,
            fontFamily: "monospace", cursor: "pointer",
            background: "rgba(100,160,255,0.15)",
            border: "1px solid rgba(100,160,255,0.3)",
            color: "rgba(180,210,255,0.9)",
          }}
        >
          <Upload style={{ width: 10, height: 10 }} />
          {uploading ? "Uploading…" : "Add Artifact"}
        </button>
        <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={handleFileInput} />
      </div>

      {/* Drop zone + artifact list */}
      <div
        style={dropZoneStyle}
        onDragOver={e => { e.preventDefault(); setDropActive(true); }}
        onDragLeave={() => setDropActive(false)}
        onDrop={handleNativeDrop}
      >
        {artifacts.length === 0 ? (
          <div style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-faint)", textAlign: "center", padding: "8px 0" }}>
            Drop a file here to upload
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {artifacts.map(m => <ArtifactPill key={m.id} module={m} />)}
          </div>
        )}
      </div>
    </div>
  );
}
