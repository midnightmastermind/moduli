// ui/commandCenter/TokensSection.jsx
//
// API tokens, in the app.
//
// Until now the only way to get one was `server/scripts/createApiToken.js` on
// the server — which is why the browser extension's own setup hint points at
// "Command Center → Connections" and there was nothing there (user, 2026-09-29:
// *"i cant copy api token from fiefox, how do i add a new one"*).
//
// MINTING TAKES THE SESSION, NEVER A TOKEN. 2026-09-24 recorded "minting stays
// a server-side script: a token that can mint tokens makes a leak permanent",
// and that reasoning still holds — a leaked bearer must not be able to issue
// itself a successor. What it rules out is minting WITH A TOKEN, not minting
// from the app, where you have already proved you are the user. The server
// enforces it (`POST /tokens` refuses anything but a session Bearer); this
// screen just cannot reach it any other way.
//
// THE SECRET IS SHOWN ONCE. Only its bcrypt hash is stored, so there is no
// "show it again" to build — the new token stays on screen until dismissed,
// and says so.
import React, { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { sessionHeaders } from "../../helpers/authStorage";

const SCOPES = [
  { value: "read", label: "Read" },
  { value: "write", label: "Write" },
];

const when = (d) => {
  if (!d) return "never";
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? "—" : t.toLocaleDateString();
};

export function TokensSection() {
  const [tokens, setTokens] = useState(null);   // null = not loaded yet
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState(["read", "write"]);
  const [minted, setMinted] = useState(null);   // the one-time raw token
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/v1/tokens", { headers: sessionHeaders() });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b?.message || `HTTP ${r.status}`);
      setTokens(b.tokens || []);
      setError(null);
    } catch (e) { setError(String(e.message || e)); setTokens([]); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!scopes.length) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/v1/tokens", {
        method: "POST",
        headers: { ...sessionHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), scopes }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b?.message || `HTTP ${r.status}`);
      setMinted(b);
      setCopied(false);
      setName("");
      load();
    } catch (e) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  };

  const revoke = async (t) => {
    // A revoke cannot be undone and silently breaks whatever is using it, so
    // the name is in the question rather than a bare "are you sure?".
    if (!window.confirm(`Revoke “${t.name || t.tokenId}”? Anything using it stops working immediately.`)) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/v1/tokens/${encodeURIComponent(t.tokenId)}`, {
        method: "DELETE", headers: sessionHeaders(),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b?.message || `HTTP ${r.status}`);
      }
      load();
    } catch (e) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  };

  // `navigator.clipboard` is unavailable over plain http and can be refused
  // outright, and this is the one value that cannot be fetched again — so the
  // failure falls back to selecting the text for a manual copy rather than
  // leaving the user with nothing.
  const copy = async () => {
    const el = document.getElementById("moduli-new-token");
    try {
      await navigator.clipboard.writeText(minted.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      el?.focus();
      el?.select?.();
      setError("Could not copy automatically — the token is selected, press Ctrl+C.");
    }
  };

  const toggleScope = (v) =>
    setScopes((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));

  const box = {
    background: "var(--input-bg)", border: "1px solid var(--border-default)",
    borderRadius: 6, color: "var(--text-primary)", padding: "5px 8px", fontSize: 12,
  };

  return (
    <div style={{ marginBottom: 20 }} data-testid="tokens-section">
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <KeyRound size={13} style={{ color: "var(--text-muted)" }} />
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>API tokens</div>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
        For the browser extension and anything else talking to <code>/api/v1</code>. A token acts as
        you. Paste it into the extension's options page; it is shown here once and never again.
      </div>

      {minted && (
        <div
          data-testid="new-token"
          style={{
            border: "1px solid var(--accent-blue-border, #3b82f6)",
            background: "var(--accent-blue-bg, rgba(59,130,246,0.12))",
            borderRadius: 6, padding: 10, marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 6 }}>
            Copy this now — it is not shown again.
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              id="moduli-new-token"
              readOnly
              value={minted.token}
              onFocus={(e) => e.target.select()}
              style={{ ...box, flex: 1, fontFamily: "monospace", fontSize: 11 }}
            />
            <button type="button" onClick={copy} style={{ ...box, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setMinted(null)}
            style={{ marginTop: 8, background: "none", border: "none", color: "var(--text-muted)", fontSize: 11, cursor: "pointer", padding: 0 }}
          >
            I've saved it — hide
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") create(); }}
          placeholder="What is it for? (e.g. Chrome extension)"
          aria-label="Token name"
          style={{ ...box, flex: "1 1 200px", minWidth: 160 }}
        />
        {SCOPES.map((s) => (
          <label key={s.value} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--text-muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={scopes.includes(s.value)} onChange={() => toggleScope(s.value)} />
            {s.label}
          </label>
        ))}
        <button
          type="button"
          onClick={create}
          disabled={busy || !scopes.length}
          style={{
            ...box, cursor: busy || !scopes.length ? "default" : "pointer",
            opacity: busy || !scopes.length ? 0.5 : 1,
            display: "flex", alignItems: "center", gap: 5,
            borderColor: "var(--accent-blue-border, #3b82f6)",
          }}
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} New token
        </button>
      </div>

      {error && <div style={{ fontSize: 11.5, color: "var(--signal-neg)", marginBottom: 8 }}>{error}</div>}

      {tokens === null ? (
        <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Loading…</div>
      ) : tokens.length === 0 ? (
        <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>No tokens yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {tokens.map((t) => (
            <div
              key={t.tokenId}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                border: "1px solid var(--border-subtle)", borderRadius: 6,
                padding: "6px 8px", fontSize: 11.5,
                opacity: t.revoked ? 0.45 : 1,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.name || "(unnamed)"} {t.revoked && <span style={{ fontWeight: 400 }}>· revoked</span>}
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: 10.5 }}>
                  <code>{t.tokenId}</code> · {(t.scopes || []).join(", ") || "no scopes"} ·
                  {" "}created {when(t.createdAt)} · last used {when(t.lastUsedAt)}
                </div>
              </div>
              {!t.revoked && (
                <button
                  type="button"
                  onClick={() => revoke(t)}
                  disabled={busy}
                  aria-label={`Revoke ${t.name || t.tokenId}`}
                  title="Revoke"
                  style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 4, display: "flex" }}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default TokensSection;
