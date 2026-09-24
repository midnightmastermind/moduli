// ui/commandCenter/StorageConnections.jsx — where uploaded files are stored
// (plan 2026-09-24-connections-storage-gdrive, Tasks 4–5; the full tab
// revamp is Task 8). Lists the Server + each connected Google Drive, picks the
// default for NEW uploads, and starts the Google sign-in.
//
// Existing files never move when the default changes — only new uploads go
// to the new place (moving old files is a separate, explicit script, Task 9).
import React, { useCallback, useEffect, useState } from "react";
import { HardDrive, Cloud, RefreshCw, Plus, Trash2 } from "lucide-react";
import { sessionHeaders } from "../../helpers/authStorage";

const mono = { fontSize: 10, fontFamily: "monospace" };

const STATUS = {
  ok: { dot: "var(--accent-green-text)", text: "connected" },
  needs_reconnect: { dot: "var(--danger-text)", text: "needs reconnect" },
  error: { dot: "var(--danger-text)", text: "error" },
};

async function jsonOrThrow(r) {
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.message || d.error || `HTTP ${r.status}`), { status: r.status, body: d });
  return d;
}

export function StorageConnections() {
  const [list, setList] = useState([]);
  const [health, setHealth] = useState({});   // id -> { ok, message, needsReconnect }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await jsonOrThrow(await fetch("/api/v1/connections", { headers: sessionHeaders() }));
      setList(d.connections || []);
      for (const c of d.connections || []) {
        if (c.id === "server") continue;
        fetch(`/api/connections/${encodeURIComponent(c.id)}/health`, { headers: sessionHeaders() })
          .then((r) => r.json()).then((h) => setHealth((prev) => ({ ...prev, [c.id]: h }))).catch(() => {});
      }
    } catch (e) { setMsg(`Could not load storage connections: ${e.message}`); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const connectGoogle = async (reconnectId = null) => {
    setBusy(true); setMsg(null);
    try {
      const d = await jsonOrThrow(await fetch("/api/connections/google/start", {
        method: "POST", headers: { "Content-Type": "application/json", ...sessionHeaders() },
        body: JSON.stringify(reconnectId ? { reconnectId } : {}),
      }));
      window.location.assign(d.url);            // Google's consent screen; it redirects back here
    } catch (e) { setMsg(e.message); setBusy(false); }
  };

  const setDefault = async (id) => {
    setBusy(true); setMsg(null);
    try {
      const d = await jsonOrThrow(await fetch("/api/v1/me/storage", {
        method: "PUT", headers: { "Content-Type": "application/json", ...sessionHeaders() },
        body: JSON.stringify({ defaultConnectionId: id }),
      }));
      setList(d.connections || []);
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  };

  const remove = async (c) => {
    if (!window.confirm(`Disconnect "${c.name}"?\n\nFiles already stored there stay in your Drive, but will not load in Moduli until you connect it again.`)) return;
    setBusy(true); setMsg(null);
    try {
      const d = await jsonOrThrow(await fetch(`/api/v1/connections/${encodeURIComponent(c.id)}`, { method: "DELETE", headers: sessionHeaders() }));
      setList(d.connections || []);
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ ...mono, fontSize: 11, color: "var(--text-muted)" }}>Storage — where new uploads go</span>
        <button onClick={load} title="Refresh" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-faint)", padding: 0, display: "inline-flex" }}>
          <RefreshCw style={{ width: 10, height: 10 }} />
        </button>
        <button
          onClick={() => connectGoogle()}
          disabled={busy}
          style={{
            marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 10px", borderRadius: 5, ...mono,
            background: "var(--accent-blue-bg)", border: "1px solid var(--accent-blue-border)", color: "var(--accent-blue-text)", cursor: busy ? "default" : "pointer",
          }}
        >
          <Plus style={{ width: 9, height: 9 }} /> Connect Google Drive
        </button>
      </div>

      {msg && <div style={{ ...mono, padding: "4px 8px", borderRadius: 5, background: "var(--input-bg)", color: "var(--danger-text)" }}>{msg}</div>}

      {list.map((c) => {
        const h = health[c.id];
        const status = c.id === "server" ? "ok" : (h?.needsReconnect ? "needs_reconnect" : h && !h.ok ? "error" : c.status || "ok");
        const s = STATUS[status] || STATUS.ok;
        const Icon = c.type === "gdrive" ? Cloud : HardDrive;
        return (
          <label key={c.id} data-testid={`storage-conn-${c.id}`} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", borderRadius: 7,
            background: "var(--input-bg)", border: `1px solid ${c.isDefault ? "var(--accent-blue-border)" : "var(--border-subtle)"}`, cursor: "pointer",
          }}>
            <input type="radio" name="storage-default" checked={!!c.isDefault} disabled={busy} onChange={() => setDefault(c.id)} title="Default for new uploads" />
            <Icon style={{ width: 12, height: 12, flexShrink: 0, color: "var(--text-muted)" }} />
            <span style={{ ...mono, fontSize: 11, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.name}{c.id === "server" ? " (this server's disk)" : ""}
            </span>
            {c.isDefault && <span style={{ ...mono, fontSize: 9, color: "var(--accent-blue-text)" }}>default</span>}
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, ...mono, color: "var(--text-faint)" }} title={h?.message || c.statusMessage || ""}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: s.dot }} />{s.text}
            </span>
            {status === "needs_reconnect" && (
              <button onClick={(e) => { e.preventDefault(); connectGoogle(c.id); }} disabled={busy}
                style={{ ...mono, padding: "1px 7px", borderRadius: 4, cursor: "pointer", background: "var(--accent-blue-bg)", border: "1px solid var(--accent-blue-border)", color: "var(--accent-blue-text)" }}>
                Reconnect
              </button>
            )}
            {c.removable && (
              <button onClick={(e) => { e.preventDefault(); remove(c); }} disabled={busy} title="Disconnect"
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-faint)", padding: 0, display: "inline-flex" }}>
                <Trash2 style={{ width: 10, height: 10 }} />
              </button>
            )}
          </label>
        );
      })}
    </div>
  );
}
