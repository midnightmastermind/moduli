// ui/commandCenter/ConnectionsTab.jsx
// Where uploaded files are stored (StorageConnections) + a direct upload.
//
// The "External path connections" section (server folders browsed and
// imported from) was removed 2026-09-24 at the user's ask — it listed two
// paths on the old dev machine that read "not found" on prod.

import React, { useState, useRef } from "react";
import { Upload } from "lucide-react";

import { useGridActions } from "../../GridActionsContext";
import { sessionHeaders } from "../../helpers/authStorage";
import { StorageConnections } from "./StorageConnections";

/** "Files › Images" — the folder chain a filed upload sits in (root excluded). */
function folderPath(folderId, foldersById) {
  const names = [];
  for (let f = foldersById?.[folderId], hops = 0; f && f.parentId && hops < 20; f = foldersById[f.parentId], hops++) names.unshift(f.name);
  return names.join(" › ");
}

export function ConnectionsTab() {
  const ctx = useGridActions();
  const { state } = ctx;
  const userId = state?.userId;
  const gridId = state?.gridId;

  const [statusMsg, setStatusMsg] = useState(null);
  const [landed, setLanded] = useState([]);     // [{ name, where, onDrive, fellBack }] — the last batch
  const uploadInputRef = useRef(null);

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !userId) return;
    const total = files.length;
    setLanded([]);
    setStatusMsg(total === 1 ? `Uploading ${files[0].name}…` : `Uploading ${total} files…`);
    let fail = 0;
    const results = await Promise.all(files.map(async (file) => {
      const form = new FormData();
      form.append("file", file);
      // No parentFolderId: the server files an upload in its home,
      // Files/<Images|Video|Audio|Documents> (server.js homeFolderForUpload).
      // This tab used to send the FIRST manifest's root, which could be the
      // Templates manifest or another grid's — so uploads landed out of sight.
      if (gridId) form.append("gridId", gridId);
      try {
        const r = await fetch("/api/artifacts/upload", { method: "POST", headers: sessionHeaders(), body: form });
        const d = await r.json();
        if (!d.module) { fail++; return { name: file.name, error: d.message || d.error || `HTTP ${r.status}` }; }
        return {
          name: file.name,
          where: folderPath(d.occurrence?.parentId, ctx.foldersById) || "Files",
          onDrive: String(d.fileRef || "").startsWith("gdrive:"),
          fellBack: !!d.storageFallback,
          dedup: !!d.dedup,
        };
      } catch (err) { fail++; return { name: file.name, error: err.message }; }
    }));
    const ok = total - fail;
    setStatusMsg(fail === 0 ? `Uploaded ${ok} file${ok === 1 ? "" : "s"}`
      : ok === 0 ? `All ${total} uploads failed` : `Uploaded ${ok} of ${total} · ${fail} failed`);
    setLanded(results);
    e.target.value = "";
  };

  return (
    <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <StorageConnections />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
        <input ref={uploadInputRef} type="file" multiple style={{ display: "none" }} onChange={handleUpload} />
        <button
          onClick={() => uploadInputRef.current?.click()}
          style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "2px 10px", borderRadius: 5, fontSize: 10, fontFamily: "monospace",
            background: "var(--accent-blue-bg)", border: "1px solid var(--accent-blue-border)",
            color: "var(--accent-blue-text)", cursor: "pointer",
          }}
        >
          <Upload style={{ width: 9, height: 9 }} /> Upload file
        </button>
        <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--text-faint)" }}>goes to the default above</span>
      </div>

      {statusMsg && (
        <div data-testid="upload-status" style={{
          fontSize: 10, fontFamily: "monospace", padding: "4px 8px", borderRadius: 5,
          background: "var(--input-bg)", color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 2,
        }}>
          <span>{statusMsg}</span>
          {landed.map((f, i) => (
            <span key={i} style={{ color: f.error || f.fellBack ? "var(--danger-text)" : "var(--text-muted)" }}>
              {f.error ? `✗ ${f.name} — ${f.error}`
                : `✓ ${f.name} → ${f.where} · ${f.onDrive ? "Google Drive" : "Server"}`
                  + (f.dedup ? " (already uploaded — reused)" : "")
                  + (f.fellBack ? " (Drive unavailable — kept on the Server)" : "")}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
