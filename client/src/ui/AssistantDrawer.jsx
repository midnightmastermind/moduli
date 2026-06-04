// ui/AssistantDrawer.jsx
//
// Jonah — the bottom-right floating button + chat drawer.
// Persona: a sophisticated turtle butler with a Gandalf-like beard.
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

// Jonah — a sophisticated turtle butler with a Gandalf-like beard.
// Pure inline SVG (no asset pipeline). Scales for the floating launcher
// (~30px) and the drawer header (~18px).
function TurtleButler({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-label="Jonah the turtle butler" role="img">
      {/* butler shoulders + white collar + bow tie */}
      <path d="M12 62 Q32 46 52 62 Z" fill="#26314d" />
      <path d="M25 50 L32 60 L39 50 Z" fill="#f4f1e8" />
      <path d="M32 50 l-7 -3 v6 z M32 50 l7 -3 v6 z" fill="#11151c" />
      <circle cx="32" cy="50" r="1.5" fill="#11151c" />
      {/* turtle head */}
      <ellipse cx="32" cy="29" rx="14" ry="15" fill="#6fbf7d" />
      <path d="M18 27 a14 14 0 0 1 28 0 Z" fill="#7fce8c" />
      {/* eyes + sophisticated monocle */}
      <circle cx="26" cy="26" r="2" fill="#16210f" />
      <circle cx="38" cy="26" r="2" fill="#16210f" />
      <circle cx="38" cy="26" r="4.2" stroke="#d8c47a" strokeWidth="1.2" fill="none" />
      <path d="M42 28 l2 6" stroke="#d8c47a" strokeWidth="1" />
      {/* brows */}
      <path d="M22 21 q4 -2 8 0 M34 21 q4 -2 8 0" stroke="#3f7a4c" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      {/* mustache + flowing Gandalf beard */}
      <path d="M26 35 q6 4 12 0" stroke="#efeee7" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M22 37 Q23 56 32 63 Q41 56 42 37 Q37 43 32 43 Q27 43 22 37 Z" fill="#efeee7" />
      <path d="M28 44 Q32 53 32 61" stroke="#d2cfc4" strokeWidth="0.9" fill="none" />
      <path d="M36 44 Q33 53 32 61" stroke="#d2cfc4" strokeWidth="0.9" fill="none" />
    </svg>
  );
}

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
          title="Jonah — at your service"
          style={{
            position: "fixed", right: 18, bottom: 18, zIndex: 9000,
            width: 52, height: 52, borderRadius: 999,
            background: "linear-gradient(135deg, #2c3340, #1a1d22)",
            color: "white", border: "1px solid rgba(255,255,255,0.18)",
            boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", padding: 0,
          }}
        ><TurtleButler size={34} /></button>
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
            <TurtleButler size={20} />
            <span style={{ fontWeight: 600, letterSpacing: 0.5 }}>Jonah</span>
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
              placeholder="Ask Jonah…"
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
