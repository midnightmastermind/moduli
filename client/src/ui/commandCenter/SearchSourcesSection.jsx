// ui/commandCenter/SearchSourcesSection.jsx — Command Center › Imports › Search sources.
// The API keys behind the dropdown searches (TMDB films + TV, USDA ingredients, …), set here instead of in the
// server's environment (user, 2026-10-31: "lets try to not let that be hardcoded, we need a section in command
// center imports that allow for search boxes and api keys for them. like our movie search too").
//
// One row per KEY, not per provider: TMDB films and TV share one account. A key is sent to the server once and
// never comes back — the list says only where each key comes from (yours / the server's / a demo key / none).
import React, { useCallback, useEffect, useState } from "react";
import { KeyRound, ExternalLink, Trash2, Save } from "lucide-react";
import { sessionHeaders } from "../../helpers/authStorage";

const small = { fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" };
const btn = {
  display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, padding: "3px 8px", borderRadius: 4,
  border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-primary)", cursor: "pointer",
};

const SOURCE_TEXT = {
  user: { text: "your key", color: "var(--accent-green-text, #86efac)" },
  server: { text: "server key", color: "var(--text-muted)" },
  demo: { text: "demo key (rate-limited)", color: "var(--accent-yellow-text, #fde68a)" },
  none: { text: "no key — search is off", color: "var(--accent-red-text, #fca5a5)" },
};

/** Fetches the key list. `fetchImpl` is for tests. */
export async function loadKeyRows(fetchImpl = fetch) {
  const r = await fetchImpl("/api/v1/search/keys", { headers: { Accept: "application/json", ...sessionHeaders() } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.message || `could not load keys (${r.status})`);
  return j.keys || [];
}

function KeyRow({ row, onSaved }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const src = SOURCE_TEXT[row.source] || SOURCE_TEXT.none;

  const send = async (method, body) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/v1/search/keys/${encodeURIComponent(row.id)}`, {
        method, headers: { "Content-Type": "application/json", ...sessionHeaders() },
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.message || `failed (${r.status})`);
      setValue(""); setMsg(method === "DELETE" ? "Removed" : "Saved"); onSaved();
    } catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div data-testid={`search-key-${row.id}`} style={{ display: "flex", flexDirection: "column", gap: 4, padding: "8px 10px",
      border: "1px solid var(--border-default)", borderRadius: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <KeyRound size={13} />
        <span style={{ fontSize: 12, fontWeight: 600 }}>{row.label}</span>
        <span style={{ ...small, color: src.color }}>{src.text}</span>
        {row.getUrl && (
          <a href={row.getUrl} target="_blank" rel="noreferrer" style={{ ...small, display: "inline-flex", gap: 3, alignItems: "center" }}>
            get a key <ExternalLink size={10} />
          </a>
        )}
      </div>
      <div style={small}>Used by: {row.providers.map((p) => p.label).join(", ")}</div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="password" autoComplete="off" value={value} placeholder={row.source === "user" ? "Replace your key…" : "Paste your key…"}
          aria-label={`${row.label} value`} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && value.trim()) send("PUT", { key: value }); }}
          style={{ flex: "1 1 auto", minWidth: 0, fontSize: 12, padding: "4px 6px", fontFamily: "monospace",
            background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border-default)", borderRadius: 4 }} />
        <button style={btn} disabled={busy || !value.trim()} onClick={() => send("PUT", { key: value })}><Save size={11} /> Save</button>
        {row.source === "user" && (
          <button style={btn} disabled={busy} title="Remove your key" onClick={() => send("DELETE")}><Trash2 size={11} /></button>
        )}
      </div>
      {msg && <div style={small}>{msg}</div>}
    </div>
  );
}

export default function SearchSourcesSection() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => {
    loadKeyRows().then((r) => { setRows(r); setError(null); }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  return (
    <div data-testid="search-sources" style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 720 }}>
      <div style={small}>
        The searches inside dropdowns (films, TV, ingredients, …) and the keys they use. Your key is stored encrypted
        on your account and never shown again; the server's own key and a service's demo key are used when you have none.
      </div>
      {error && <div style={{ ...small, color: "var(--accent-red-text, #fca5a5)" }}>{error}</div>}
      {!rows && !error && <div style={small}>Loading…</div>}
      {rows && rows.length === 0 && <div style={small}>No search source needs a key.</div>}
      {rows && rows.map((row) => <KeyRow key={row.id} row={row} onSaved={reload} />)}
    </div>
  );
}
