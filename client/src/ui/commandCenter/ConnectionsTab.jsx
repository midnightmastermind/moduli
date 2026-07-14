// ui/commandCenter/ConnectionsTab.jsx
// ConnectionsTab

import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { ChevronDown, ChevronRight, FolderOpen, RefreshCw, Upload, Download } from "lucide-react";

import { useGridActions } from "../../GridActionsContext";

const labelStyle = {
  fontSize: 10,
  color: "var(--text-muted)",
  fontFamily: "monospace",
  display: "block",
  marginBottom: 3,
};

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

export function ConnectionsTab() {
  const ctx = useGridActions();
  const { state, socket } = ctx;
  const userId = state?.userId;
  const gridId = state?.gridId;
  const manifestId = useMemo(() => Object.values(ctx.manifestsById || {})[0]?.id, [ctx.manifestsById]);
  const folderId = useMemo(() => {
    const manifest = Object.values(ctx.manifestsById || {})[0];
    return manifest?.rootFolderId || null;
  }, [ctx.manifestsById]);

  const [connections, setConnections] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [filesByConn, setFilesByConn] = useState({});
  const [loadingId, setLoadingId] = useState(null);
  const [importingFile, setImportingFile] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);
  const uploadInputRef = useRef(null);

  const fetchConnections = useCallback(() => {
    fetch("/api/connections")
      .then((r) => r.json())
      .then((d) => setConnections(d.connections || []))
      .catch(() => {});
  }, []);

  useEffect(() => { fetchConnections(); }, [fetchConnections]);

  const toggleExpand = async (connId) => {
    if (expandedId === connId) { setExpandedId(null); return; }
    setExpandedId(connId);
    if (filesByConn[connId]) return;
    setLoadingId(connId);
    try {
      const r = await fetch(`/api/connections/${connId}/files`);
      const d = await r.json();
      setFilesByConn((prev) => ({ ...prev, [connId]: d.files || [] }));
    } catch {}
    setLoadingId(null);
  };

  const refreshFiles = async (connId) => {
    setLoadingId(connId);
    try {
      const r = await fetch(`/api/connections/${connId}/files`);
      const d = await r.json();
      setFilesByConn((prev) => ({ ...prev, [connId]: d.files || [] }));
    } catch {}
    setLoadingId(null);
  };

  const importFile = async (connId, fileName) => {
    setImportingFile(`${connId}:${fileName}`);
    setStatusMsg(null);
    try {
      const r = await fetch(`/api/connections/${connId}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName, userId, gridId, parentFolderId: folderId }),
      });
      const d = await r.json();
      if (d.module) setStatusMsg(`Imported: ${fileName}`);
      else setStatusMsg(`Error: ${d.error || "Unknown error"}`);
    } catch (err) {
      setStatusMsg(`Error: ${err.message}`);
    }
    setImportingFile(null);
    setTimeout(() => setStatusMsg(null), 3000);
  };

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !userId) return;
    const total = files.length;
    setStatusMsg(total === 1 ? `Uploading ${files[0].name}…` : `Uploading ${total} files…`);
    let ok = 0, fail = 0;
    await Promise.all(files.map(async (file) => {
      const form = new FormData();
      form.append("file", file);
      form.append("userId", userId);
      if (gridId) form.append("gridId", gridId);
      if (folderId) form.append("parentFolderId", folderId);
      try {
        const r = await fetch("/api/artifacts/upload", { method: "POST", body: form });
        const d = await r.json();
        if (d.module) ok++; else fail++;
      } catch { fail++; }
    }));
    setStatusMsg(
      fail === 0 ? `Uploaded ${ok} file${ok === 1 ? "" : "s"}`
      : ok === 0 ? `All ${total} uploads failed`
      : `Uploaded ${ok} of ${total} · ${fail} failed`
    );
    e.target.value = "";
    setTimeout(() => setStatusMsg(null), 3000);
  };

  return (
    <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
        <span style={{ ...labelStyle, fontSize: 11, color: "var(--text-muted)", marginBottom: 0 }}>
          External path connections
        </span>
        <button
          onClick={fetchConnections}
          title="Refresh"
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-faint)", padding: 0, display: "inline-flex" }}
        >
          <RefreshCw style={{ width: 10, height: 10 }} />
        </button>
        {/* Hidden file input for direct upload */}
        <input ref={uploadInputRef} type="file" multiple style={{ display: "none" }} onChange={handleUpload} />
        <button
          onClick={() => uploadInputRef.current?.click()}
          style={{
            marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4,
            padding: "2px 10px", borderRadius: 5, fontSize: 10, fontFamily: "monospace",
            background: "var(--accent-blue-bg)", border: "1px solid var(--accent-blue-border)",
            color: "var(--accent-blue-text)", cursor: "pointer",
          }}
        >
          <Upload style={{ width: 9, height: 9 }} /> Upload file
        </button>
      </div>

      {statusMsg && (
        <div style={{
          fontSize: 10, fontFamily: "monospace", padding: "4px 8px", borderRadius: 5,
          background: "var(--input-bg)", color: "var(--text-muted)",
        }}>
          {statusMsg}
        </div>
      )}

      {connections.length === 0 && (
        <div style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "monospace", padding: "10px 0" }}>
          No connections configured
        </div>
      )}

      {connections.map((conn) => {
        const isExpanded = expandedId === conn.id;
        const isLoading = loadingId === conn.id;
        const connFiles = filesByConn[conn.id] || [];

        return (
          <div
            key={conn.id}
            style={{
              background: "var(--input-bg)",
              border: `1px solid ${conn.exists ? "var(--border-subtle)" : "var(--danger-border)"}`,
              borderRadius: 7, overflow: "hidden",
            }}
          >
            {/* Connection header */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px" }}>
              <button
                onClick={() => toggleExpand(conn.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, flex: 1,
                  background: "none", border: "none", cursor: "pointer",
                  color: conn.exists ? "var(--text-primary)" : "var(--danger-text)",
                  fontSize: 11, fontFamily: "monospace", textAlign: "left",
                }}
              >
                {isExpanded
                  ? <ChevronDown style={{ width: 11, height: 11, flexShrink: 0 }} />
                  : <ChevronRight style={{ width: 11, height: 11, flexShrink: 0 }} />
                }
                <FolderOpen style={{ width: 11, height: 11, flexShrink: 0, color: "rgb(251,191,36)" }} />
                <strong>{conn.name}</strong>
                <span style={{ opacity: 0.38, fontSize: 10, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {conn.path}
                </span>
              </button>
              <span style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "monospace", flexShrink: 0 }}>
                {conn.exists ? `${conn.fileCount} files` : "not found"}
              </span>
              {isExpanded && conn.exists && (
                <button
                  onClick={() => refreshFiles(conn.id)}
                  title="Refresh"
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-faint)", padding: 0, display: "inline-flex" }}
                >
                  <RefreshCw style={{ width: 9, height: 9 }} />
                </button>
              )}
            </div>

            {/* Files list */}
            {isExpanded && (
              <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "4px 0" }}>
                {isLoading && (
                  <div style={{ padding: "6px 12px", fontSize: 10, color: "var(--text-faint)", fontFamily: "monospace" }}>
                    Loading…
                  </div>
                )}
                {!isLoading && !conn.exists && (
                  <div style={{ padding: "6px 12px", fontSize: 10, color: "var(--danger-text)", fontFamily: "monospace" }}>
                    Path does not exist: {conn.path}
                  </div>
                )}
                {!isLoading && conn.exists && connFiles.length === 0 && (
                  <div style={{ padding: "6px 12px", fontSize: 10, color: "var(--text-faint)", fontFamily: "monospace" }}>
                    Empty directory
                  </div>
                )}
                {!isLoading && connFiles.map((f) => (
                  <div
                    key={f.name}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "3px 12px", fontSize: 10, fontFamily: "monospace",
                      color: "var(--text-muted)",
                    }}
                  >
                    <span style={{ flexShrink: 0 }}>{fileIcon(f.name, f.isDirectory)}</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                    {!f.isDirectory && (
                      <>
                        <span style={{ opacity: 0.35, flexShrink: 0 }}>{formatBytes(f.size)}</span>
                        <button
                          onClick={() => importFile(conn.id, f.name)}
                          disabled={importingFile === `${conn.id}:${f.name}`}
                          title="Import into manifest"
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 3,
                            padding: "1px 7px", borderRadius: 4, fontSize: 9,
                            fontFamily: "monospace", cursor: "pointer", flexShrink: 0,
                            background: "var(--accent-green-bg)",
                            border: "1px solid var(--accent-green-border)",
                            color: importingFile === `${conn.id}:${f.name}` ? "var(--text-faint)" : "var(--accent-green-text)",
                          }}
                        >
                          <Download style={{ width: 7, height: 7 }} />
                          {importingFile === `${conn.id}:${f.name}` ? "…" : "Import"}
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
