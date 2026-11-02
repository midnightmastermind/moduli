// ui/commandCenter/JellyfinSection.jsx — Command Center › Connections › Jellyfin.
// The media server Moduli streams from. The server-side address is how Moduli's SERVER reaches Jellyfin; the
// public address is what a browser uses. The API key is write-only: it is sent once and never comes back.
import React, { useCallback, useEffect, useState } from "react";
import { Film } from "lucide-react";
import { sessionHeaders } from "../../helpers/authStorage";

const small = { fontSize: 11, color: "var(--text-muted)" };
const input = {
  fontSize: 12, padding: "4px 8px", borderRadius: 4, width: "100%",
  border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-primary)",
};
const btn = {
  fontSize: 11, padding: "3px 10px", borderRadius: 4, cursor: "pointer",
  border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-primary)",
};

const api = async (method, path, body) => {
  const r = await fetch(`/api/v1/jellyfin/${path}`, {
    method, headers: { "Content-Type": "application/json", ...sessionHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || `failed (${r.status})`);
  return j;
};

export function JellyfinSection() {
  const [form, setForm] = useState({ baseUrl: "", publicUrl: "", jfUserId: "", apiKey: "" });
  const [configured, setConfigured] = useState(false);
  const [status, setStatus] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const c = await api("GET", "config");
      setConfigured(!!c.configured);
      setForm((f) => ({ ...f, baseUrl: c.baseUrl || "", publicUrl: c.publicUrl || "", jfUserId: c.jfUserId || "", apiKey: "" }));
      if (c.configured) setStatus(await api("GET", "status").catch(() => null)); else setStatus(null);
    } catch (e) { setMsg(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true); setMsg(null);
    try { await api("PUT", "config", form); setMsg("Saved"); await load(); }
    catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setMsg(null);
    try { await api("DELETE", "config"); setMsg("Removed"); await load(); }
    catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  let line = "Not configured";
  if (configured) line = status?.error === "bad_key" ? "Jellyfin rejected the API key"
    : status?.online ? `Connected — ${status.serverName || "Jellyfin"}` : "Saved, but Jellyfin is not reachable";

  return (
    <div data-testid="jellyfin-section" style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px",
      border: "1px solid var(--border-default)", borderRadius: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Film size={13} />
        <span style={{ fontSize: 12, fontWeight: 600 }}>Jellyfin</span>
        <span data-testid="jellyfin-status" style={small}>{line}</span>
      </div>
      <label style={small}>Jellyfin address (how the server reaches it)
        <input aria-label="Jellyfin address" style={input} value={form.baseUrl} onChange={set("baseUrl")} placeholder="http://127.0.0.1:8097" />
      </label>
      <label style={small}>Public address (what the browser uses)
        <input aria-label="Public address" style={input} value={form.publicUrl} onChange={set("publicUrl")} placeholder="https://media.viafluere.com" />
      </label>
      <label style={small}>Your Jellyfin user id
        <input aria-label="Jellyfin user id" style={input} value={form.jfUserId} onChange={set("jfUserId")} />
      </label>
      <label style={small}>API key {configured && <span data-testid="jellyfin-key-saved">· Key saved</span>}
        <input aria-label="Jellyfin API key" type="password" autoComplete="off" style={input} value={form.apiKey}
          onChange={set("apiKey")} placeholder={configured ? "Leave blank to keep the saved key" : ""} />
      </label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" style={btn} disabled={busy} onClick={save}>Save</button>
        {configured && <button type="button" style={btn} disabled={busy} onClick={remove}>Remove</button>}
        {msg && <span style={small}>{msg}</span>}
      </div>
    </div>
  );
}
