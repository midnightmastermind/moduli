// ui/commandCenter/ConnectionsTab.jsx
// Where uploaded files are stored (StorageConnections) + a direct upload.
//
// The "External path connections" section (server folders browsed and
// imported from) was removed 2026-09-24 at the user's ask — it listed two
// paths on the old dev machine that read "not found" on prod.

import React, { useState, useMemo, useRef } from "react";
import { Upload } from "lucide-react";

import { useGridActions } from "../../GridActionsContext";
import { sessionHeaders } from "../../helpers/authStorage";
import { StorageConnections } from "./StorageConnections";

export function ConnectionsTab() {
  const ctx = useGridActions();
  const { state } = ctx;
  const userId = state?.userId;
  const gridId = state?.gridId;
  const folderId = useMemo(() => {
    const manifest = Object.values(ctx.manifestsById || {})[0];
    return manifest?.rootFolderId || null;
  }, [ctx.manifestsById]);

  const [statusMsg, setStatusMsg] = useState(null);
  const uploadInputRef = useRef(null);

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !userId) return;
    const total = files.length;
    setStatusMsg(total === 1 ? `Uploading ${files[0].name}…` : `Uploading ${total} files…`);
    let ok = 0, fail = 0, fellBack = 0;
    await Promise.all(files.map(async (file) => {
      const form = new FormData();
      form.append("file", file);
      if (gridId) form.append("gridId", gridId);
      if (folderId) form.append("parentFolderId", folderId);
      try {
        const r = await fetch("/api/artifacts/upload", { method: "POST", headers: sessionHeaders(), body: form });
        const d = await r.json();
        if (d.module) { ok++; if (d.storageFallback) fellBack++; } else fail++;
      } catch { fail++; }
    }));
    const base = fail === 0 ? `Uploaded ${ok} file${ok === 1 ? "" : "s"}`
      : ok === 0 ? `All ${total} uploads failed`
      : `Uploaded ${ok} of ${total} · ${fail} failed`;
    // A Drive that could not take the file stores it on the Server instead — say so.
    setStatusMsg(fellBack ? `${base} · ${fellBack} kept on the Server (Drive unavailable)` : base);
    e.target.value = "";
    setTimeout(() => setStatusMsg(null), fellBack ? 8000 : 3000);
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
        <div style={{
          fontSize: 10, fontFamily: "monospace", padding: "4px 8px", borderRadius: 5,
          background: "var(--input-bg)", color: "var(--text-muted)",
        }}>
          {statusMsg}
        </div>
      )}
    </div>
  );
}
