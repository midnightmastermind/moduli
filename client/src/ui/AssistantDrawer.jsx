// ui/AssistantDrawer.jsx
//
// Jarvis — the bottom-right floating button + chat drawer.
//
// State is local to this component (chat history, drawer open/closed,
// input value). Every API call goes through /api/v1/assistant/chat
// with the user's existing API token (read from localStorage; see
// the "API token" section in docs/assistant-guide.md for how to mint
// + paste it).
//
// Server picks the agent mode automatically: ANTHROPIC_API_KEY set →
// real LLM. Otherwise → deterministic dispatcher that handles a
// handful of patterns. Either way the chatbox works.

import React, { useEffect, useRef, useState, useContext } from "react";
import { GridActionsContext, useGridActions } from "../GridActionsContext";

const STORAGE_KEY = "moduli_api_token";
const HISTORY_KEY = "moduli_assistant_history";

export default function AssistantDrawer() {
  const ctx = useGridActions();
  const gridId = ctx?.state?.grid?._id || ctx?.state?.grid?.id;
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState(() => localStorage.getItem(STORAGE_KEY) || "");
  const [messages, setMessages] = useState(() => {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(messages));
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, token);
  }, [token]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    if (!token) { setShowSettings(true); return; }
    const nextHistory = [...messages, { role: "user", content: text }];
    setMessages(nextHistory);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/v1/assistant/chat", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: nextHistory, gridId }),
      });
      const j = await res.json();
      if (!res.ok) {
        setMessages(m => [...m, { role: "assistant", content: `(error ${res.status}) ${j?.message || JSON.stringify(j)}` }]);
        return;
      }
      // Render the assistant turns + any tool calls.
      const fresh = [];
      for (const t of (j.transcript || [])) {
        if (t.role === "tool") {
          fresh.push({ role: "tool", name: t.name, output: t.output });
        } else if (t.role === "assistant") {
          fresh.push({ role: "assistant", content: t.content || "(no text)", toolCalls: t.toolCalls });
        }
      }
      setMessages(m => [...m, ...fresh, { role: "_meta", mode: j.mode, model: j.model }]);
    } catch (e) {
      setMessages(m => [...m, { role: "assistant", content: `(network error) ${String(e?.message || e)}` }]);
    } finally {
      setBusy(false);
    }
  }

  function clearHistory() {
    setMessages([]);
    localStorage.removeItem(HISTORY_KEY);
  }

  return (
    <>
      {/* Floating launcher button — bottom-right of viewport */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="Jarvis"
          style={{
            position: "fixed", right: 18, bottom: 18, zIndex: 9000,
            width: 52, height: 52, borderRadius: 999,
            background: "linear-gradient(135deg, #2c3340, #1a1d22)",
            color: "white", border: "1px solid rgba(255,255,255,0.18)",
            boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22, cursor: "pointer",
          }}
        >J</button>
      )}

      {/* Slide-in chat drawer */}
      {open && (
        <div
          style={{
            position: "fixed", right: 16, bottom: 16, zIndex: 9001,
            width: 380, maxWidth: "calc(100vw - 32px)",
            height: 560, maxHeight: "calc(100vh - 32px)",
            background: "var(--surface, #1d2125)",
            color: "var(--text-primary, #f0f0f0)",
            border: "1px solid var(--border-default, rgba(255,255,255,0.12))",
            borderRadius: 10,
            boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
            display: "flex", flexDirection: "column",
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 12,
          }}
        >
          {/* Header */}
          <div style={{
            padding: "8px 12px", display: "flex", alignItems: "center", gap: 8,
            borderBottom: "1px solid var(--border-default, rgba(255,255,255,0.08))",
          }}>
            <span style={{ fontWeight: 600, letterSpacing: 0.5 }}>Jarvis</span>
            <span style={{ opacity: 0.5, fontSize: 10 }}>at your service</span>
            <span style={{ flex: 1 }} />
            <button onClick={() => setShowSettings(s => !s)} style={iconBtn} title="Settings">⚙</button>
            <button onClick={clearHistory} style={iconBtn} title="Clear history">⌫</button>
            <button onClick={() => setOpen(false)} style={iconBtn} title="Close">×</button>
          </div>

          {/* Settings panel */}
          {showSettings && (
            <div style={{ padding: 10, borderBottom: "1px solid var(--border-default, rgba(255,255,255,0.08))", background: "rgba(0,0,0,0.15)" }}>
              <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 4 }}>API token (Bearer)</div>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="moduli_..."
                style={{
                  width: "100%", padding: 6, fontSize: 11, fontFamily: "inherit",
                  background: "var(--input-bg, #14171c)", color: "inherit",
                  border: "1px solid var(--border-default, rgba(255,255,255,0.12))",
                  borderRadius: 4,
                }}
              />
              <div style={{ fontSize: 9, opacity: 0.55, marginTop: 4 }}>
                Mint with: <code>node --env-file=.env server/scripts/createApiToken.js &lt;email&gt;</code>.
                See <code>docs/assistant-guide.md</code>.
              </div>
            </div>
          )}

          {/* Transcript */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {messages.length === 0 && (
              <div style={{ opacity: 0.5, fontSize: 11, padding: 8 }}>
                Type <code>look up giraffes</code> or <code>wiki photosynthesis</code> to start.
                Full guide in <code>docs/assistant-guide.md</code>.
              </div>
            )}
            {messages.map((m, i) => <MessageBubble key={i} msg={m} />)}
            {busy && <div style={{ opacity: 0.6, fontSize: 11 }}>… thinking</div>}
          </div>

          {/* Input */}
          <div style={{ padding: 8, borderTop: "1px solid var(--border-default, rgba(255,255,255,0.08))", display: "flex", gap: 6 }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask Jarvis…"
              rows={2}
              style={{
                flex: 1, fontFamily: "inherit", fontSize: 12, padding: 6,
                background: "var(--input-bg, #14171c)", color: "inherit", resize: "none",
                border: "1px solid var(--border-default, rgba(255,255,255,0.12))",
                borderRadius: 4,
              }}
            />
            <button onClick={send} disabled={busy || !input.trim()} style={{
              padding: "0 12px", background: "var(--accent-blue, #4372ac)", color: "white",
              border: "none", borderRadius: 4, cursor: busy ? "wait" : "pointer", opacity: busy ? 0.5 : 1,
            }}>Send</button>
          </div>
        </div>
      )}
    </>
  );
}

function MessageBubble({ msg }) {
  if (msg.role === "_meta") {
    return (
      <div style={{ alignSelf: "center", fontSize: 9, opacity: 0.4 }}>
        ↳ {msg.mode}{msg.model ? ` · ${msg.model}` : ""}
      </div>
    );
  }
  if (msg.role === "tool") {
    return (
      <details style={{ alignSelf: "flex-start", fontSize: 10, opacity: 0.75, background: "rgba(255,255,255,0.04)", padding: 6, borderRadius: 4 }}>
        <summary style={{ cursor: "pointer" }}>tool: <code>{msg.name}</code></summary>
        <pre style={{ margin: "6px 0 0", maxHeight: 160, overflow: "auto", fontSize: 10 }}>{JSON.stringify(msg.output, null, 2)}</pre>
      </details>
    );
  }
  const isUser = msg.role === "user";
  return (
    <div style={{
      alignSelf: isUser ? "flex-end" : "flex-start",
      maxWidth: "90%",
      background: isUser ? "var(--accent-blue, #4372ac)" : "rgba(255,255,255,0.06)",
      color: isUser ? "white" : "inherit",
      padding: "6px 10px", borderRadius: 8,
      whiteSpace: "pre-wrap", wordBreak: "break-word",
    }}>
      {msg.content}
      {msg.toolCalls?.length > 0 && (
        <div style={{ fontSize: 9, opacity: 0.6, marginTop: 4 }}>
          → called: {msg.toolCalls.map(t => t.name).join(", ")}
        </div>
      )}
    </div>
  );
}

const iconBtn = {
  background: "transparent", color: "inherit", border: "none", cursor: "pointer",
  padding: "2px 6px", fontSize: 14, opacity: 0.7,
};
