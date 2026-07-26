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

import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useGridActions } from "../GridActionsContext";
import { getCurrentLocation, subscribeCurrentLocation } from "../helpers/currentLocation";
import MiniGridMap from "../mobile/MiniGridMap";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { jumpToOccurrence } from "../helpers/jumpToOccurrence";
import { openOccurrenceInPanel } from "../helpers/openOccurrenceInPanel";
import { createImportsDocPage, ensureImportsFolderAndPage, shouldWrapImportOutput } from "../helpers/importsFolder";

const STORAGE_KEY = "moduli_api_token";
const HISTORY_KEY = "moduli_assistant_history";
// The last seed marker (grid.meta.assistantSeedId) this browser saw. createLiveData
// stamps a fresh marker every reseed; when it changes we clear the chat history so a
// reseed starts the conversation fresh (see the seed-marker effect below).
const SEED_KEY = "moduli_assistant_seed";
// Rolling log of recent successful round-trip durations (ms) so the "thinking"
// bar can show a realistic ETA — the local model is slow, so a learned typical
// time + elapsed counter is far more useful than a static "… thinking".
const DURATIONS_KEY = "moduli_assistant_durations";
function loadDurations() {
  try { const a = JSON.parse(localStorage.getItem(DURATIONS_KEY) || "[]"); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
function recordDuration(ms) {
  if (!(ms > 0)) return;
  const a = loadDurations(); a.push(ms);
  while (a.length > 12) a.shift();          // keep the last 12
  try { localStorage.setItem(DURATIONS_KEY, JSON.stringify(a)); } catch { /* quota */ }
}
function typicalDuration() {
  const a = loadDurations();
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);   // median = robust to outliers
  return s[Math.floor(s.length / 2)];
}
// Hard ceiling on a single chat round-trip. Kept just above the server's total
// generation budget (OLLAMA_TOTAL_BUDGET_MS, 300s) plus slack for tool runtime,
// so the drawer resolves to a visible error instead of an endless "… thinking"
// only if something upstream truly wedges — not on a normal (slow) local run.
const CHAT_TIMEOUT_MS = 360000;

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
  const [progress, setProgress] = useState(null);
  const [streamingText, setStreamingText] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [location, setLocation] = useState(() => getCurrentLocation());
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef(0);
  // Learned "typical" duration (median of recent runs) — re-read each time a
  // request starts so the ETA reflects the latest history.
  const typical = useMemo(() => (busy ? typicalDuration() : null), [busy]);
  const scrollRef = useRef(null);
  const socket = ctx?.socket;

  // Live progress from the server loop. `token` deltas stream the model's words
  // as it writes (so you see it narrate live, like Claude, instead of a silent
  // multi-minute wait); `thinking`/`tool` drive the status line.
  useEffect(() => {
    if (!socket) return;
    const onProg = (ev) => {
      if (!ev || ev.phase === "done") { setProgress(null); return; }
      if (ev.phase === "token") { setStreamingText(t => t + (ev.delta || "")); return; }
      if (ev.phase === "thinking") setStreamingText("");  // a fresh generation is starting
      setProgress(ev);
    };
    socket.on("assistant_progress", onProg);
    return () => socket.off("assistant_progress", onProg);
  }, [socket]);

  // Track the user's current location (last-opened page/folder) so "here" /
  // "this folder" resolve server-side without the user naming an id.
  useEffect(() => subscribeCurrentLocation(setLocation), []);

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(messages));
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Follow the live stream as tokens arrive (messages[] doesn't change mid-stream).
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [streamingText]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, token);
  }, [token]);

  // Tick the elapsed-time counter while a request is in flight, so the thinking
  // bar shows live "12s / ~20s" feedback during the slow local-model wait.
  useEffect(() => {
    if (!busy) { setElapsedMs(0); return; }
    startRef.current = Date.now();
    setElapsedMs(0);
    const id = setInterval(() => setElapsedMs(Date.now() - startRef.current), 200);
    return () => clearInterval(id);
  }, [busy]);

  // Fetch the assistant key from the server. Sends the app's own login JWT so
  // the server can hand back the signed-in user's key over any origin (incl. the
  // public domain) — that's what makes auto-connect work in production, not just
  // on localhost / LAN. Returns the key or null.
  const fetchAssistantKey = useCallback(async () => {
    try {
      const jwt = localStorage.getItem("moduli-token");
      const r = await fetch(
        "/api/v1/assistant/bootstrap-token",
        jwt ? { headers: { Authorization: `Bearer ${jwt}` } } : undefined
      );
      if (!r.ok) return null;
      const j = await r.json();
      return j?.token || null;
    } catch { return null; }
  }, []);

  // Auto-connect when the drawer has no saved key (fresh browser / new session).
  // A key the user already pasted is never overwritten.
  useEffect(() => {
    if (token) return;
    let cancelled = false;
    fetchAssistantKey().then((t) => { if (!cancelled && t) setToken(t); });
    return () => { cancelled = true; };
  }, []); // mount only — don't re-fetch after the user sets a key

  // Clear the chat history on reseed. createLiveData stamps a fresh
  // grid.meta.assistantSeedId every run; when the marker we last saw changes, wipe
  // the transcript so a reseed starts Jonah fresh. The FIRST sighting of a marker
  // (no stored value) just records it — we don't nuke an existing conversation the
  // first time this ships. seedId arrives with full_state, so the [seedId] dep
  // re-runs once the grid loads.
  const seedId = ctx?.state?.grid?.meta?.assistantSeedId || null;
  useEffect(() => {
    if (!seedId) return;
    const seen = localStorage.getItem(SEED_KEY);
    if (seen === seedId) return;
    if (seen != null) {
      setMessages([]);
      localStorage.removeItem(HISTORY_KEY);
    }
    localStorage.setItem(SEED_KEY, seedId);
  }, [seedId]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    if (!token) { setShowSettings(true); return; }
    const nextHistory = [...messages, { role: "user", content: text }];
    setMessages(nextHistory);
    setInput("");
    setBusy(true);
    setProgress(null);
    setStreamingText("");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CHAT_TIMEOUT_MS);
    try {
      const res = await fetch("/api/v1/assistant/chat", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: nextHistory,
          gridId,
          // Current location so "here" / "this folder" / "this page" resolve.
          context: location ? { id: location.id, label: location.label, type: location.type } : null,
        }),
        signal: ctrl.signal,
      });
      const j = await res.json();
      if (!res.ok) {
        // 401/403 = the saved key is stale (e.g. a new session). Self-heal: ask
        // the server for a fresh key (using the app login) and, if we get a new
        // one, swap it in and tell the user to resend. Only if that fails do we
        // ask them to re-enter it in Settings — no internal/dev wording.
        const authFail = res.status === 401 || res.status === 403;
        if (authFail) {
          const fresh = await fetchAssistantKey();
          if (fresh && fresh !== token) {
            setToken(fresh);
            setMessages(m => [...m, { role: "assistant", content: "Reconnected — please send that again." }]);
          } else {
            setMessages(m => [...m, { role: "assistant", content: "I'm not connected right now. Open ⚙ Settings, clear the saved key, and paste your assistant key again." }]);
            setShowSettings(true);
          }
          return;
        }
        setMessages(m => [...m, { role: "assistant", content: `(error ${res.status}) ${j?.message || JSON.stringify(j)}` }]);
        return;
      }
      // Learn how long a normal round-trip takes so the next "thinking" bar
      // shows a realistic ETA.
      recordDuration(Date.now() - startRef.current);
      // Render the assistant turns + any tool calls.
      const fresh = [];
      for (const t of (j.transcript || [])) {
        if (t.role === "tool") {
          fresh.push({ role: "tool", name: t.name, output: t.output });
        } else if (t.role === "assistant") {
          fresh.push({ role: "assistant", content: t.content || "", toolCalls: t.toolCalls });
        }
      }
      // Destructive tools come back as pending confirmations — render an
      // Approve/Decline card for each. Carry the user's request text so the
      // card can best-guess the location from it (the time/place lives there,
      // not in the tool args).
      const confirms = (j.pendingConfirmations || []).map(pc => ({
        role: "confirm", name: pc.name, input: pc.input, description: pc.description, status: "pending", userText: text,
      }));
      // After a create/import tool runs, offer to show the new content in a
      // panel via the grid-map picker (gated live to page/container content
      // that isn't already visible — see PanelPickCard).
      const panelPicks = [];
      for (const t of fresh) {
        if (t.role !== "tool") continue;
        const occId = extractCreatedOccId(t.name, t.output);
        if (occId) panelPicks.push({ role: "panel_pick", occId });
      }
      setMessages(m => [...m, ...fresh, ...confirms, ...panelPicks, { role: "_meta", mode: j.mode, model: j.model }]);
    } catch (e) {
      const msg = e?.name === "AbortError"
        ? `(timed out after ${Math.round(CHAT_TIMEOUT_MS / 1000)}s) Jonah didn't respond in time — the local model may be slow or stuck.`
        : `(network error) ${String(e?.message || e)}`;
      setMessages(m => [...m, { role: "assistant", content: msg }]);
    } finally {
      clearTimeout(timer);
      setBusy(false);
      setProgress(null);
      setStreamingText("");
    }
  }

  function clearHistory() {
    setMessages([]);
    localStorage.removeItem(HISTORY_KEY);
  }

  // Forget the cached Bearer token (the "clear my cookies" path). The token
  // lives only in localStorage; removing it lets the user paste a fresh one.
  function clearToken() {
    setToken("");
    localStorage.removeItem(STORAGE_KEY);
  }

  // Approve/Decline a destructive action card. Approve runs the single tool
  // via /assistant/confirm; Decline just marks it cancelled.
  async function resolveConfirm(idx, approve, editedInput) {
    const card = messages[idx];
    if (!card || card.role !== "confirm" || card.status !== "pending" || busy) return;
    setMessages(m => m.map((mm, i) => (i === idx ? { ...mm, status: approve ? "approved" : "declined" } : mm)));
    if (!approve) {
      setMessages(m => [...m, { role: "assistant", content: "Cancelled — nothing was changed." }]);
      return;
    }
    // editedInput carries any user corrections from the card (e.g. the location).
    const finalInput = editedInput || card.input;
    setBusy(true);
    try {
      const res = await fetch("/api/v1/assistant/confirm", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: card.name, input: finalInput, gridId }),
      });
      const j = await res.json();
      if (!res.ok || j.ok === false) {
        setMessages(m => [...m, { role: "assistant", content: `(error) ${j?.error || j?.message || res.status}` }]);
      } else if (card.name === "wikipedia_import_batch" && Array.isArray(j.output?.imported)) {
        // Batch import: wrap EACH imported root in a doc page under the shared
        // "Imports" folder. Ensure the folder (+ its folder-page card occurrence)
        // ONCE up front, then reuse its id across the batch.
        const grid = ctx?.state?.grid;
        const userId = ctx?.state?.userId;
        const { folderId: importsFolderId, folderPageOccId } = ensureImportsFolderAndPage({
          grid, manifests: Object.values(ctx?.manifestsById || {}),
          folders: Object.values(ctx?.foldersById || {}),
          occurrencesById: ctx?.occurrencesById,
          dispatch: ctx?.dispatch, socket: ctx?.socket, userId,
        });
        for (const { title, rootOccurrenceId } of j.output.imported) {
          if (!rootOccurrenceId) continue;
          createImportsDocPage({
            rootOccId: rootOccurrenceId, folderId: importsFolderId, grid,
            dispatch: ctx?.dispatch, socket: ctx?.socket, userId, label: title,
          });
        }
        // Ask where to open: target the Imports FOLDER page so the user can pin
        // it to a panel and drill into the imported pages (mirrors the per-item
        // panel-pick the single-import path gets).
        setMessages(m => [
          ...m,
          { role: "tool", name: card.name, output: j.output },
          ...(folderPageOccId ? [{ role: "panel_pick", occId: folderPageOccId }] : []),
        ]);
      } else if (isImportTool(card.name) && j.output?.dryRun) {
        // A DRY RUN planned the tree but minted/persisted nothing. It still returns a
        // (planned) rootOccurrenceId — wrapping that into a persisted Imports page
        // leaves a page whose embed points at an occurrence that never existed (the
        // "empty embed" placeholder). So surface the plan instead of wrapping.
        setMessages(m => [
          ...m,
          { role: "tool", name: card.name, output: j.output },
          { role: "assistant", content: "(planned only — nothing was imported. Re-run without dry-run to actually import it.)" },
        ]);
      } else if (isImportTool(card.name) && shouldWrapImportOutput(j.output)) {
        // SINGLE import (wikipedia_import / import_markdown / import_html): wrap the
        // root in a doc page under the shared "Imports" folder — same as the batch
        // path — so an import ALWAYS lands somewhere visible (the importer roots
        // content with parentId:null, so without this it's loose at the grid root and
        // shows up nowhere). The panel-pick card alone doesn't guarantee a home (the
        // user can dismiss it, or it may not render before the occurrence syncs).
        const grid = ctx?.state?.grid;
        const userId = ctx?.state?.userId;
        const { folderId: importsFolderId, folderPageOccId } = ensureImportsFolderAndPage({
          grid, manifests: Object.values(ctx?.manifestsById || {}),
          folders: Object.values(ctx?.foldersById || {}),
          occurrencesById: ctx?.occurrencesById,
          dispatch: ctx?.dispatch, socket: ctx?.socket, userId,
        });
        createImportsDocPage({
          rootOccId: j.output.rootOccurrenceId, folderId: importsFolderId, grid,
          dispatch: ctx?.dispatch, socket: ctx?.socket, userId,
          label: j.output?.source?.title || card.input?.title || card.input?.query || "Imported",
        });
        // Ask where to open: target the Imports FOLDER page (mirrors the batch path).
        setMessages(m => [
          ...m,
          { role: "tool", name: card.name, output: j.output },
          ...(folderPageOccId ? [{ role: "panel_pick", occId: folderPageOccId }] : []),
        ]);
      } else {
        // Surface a panel picker for newly created page/container content.
        const occId = extractCreatedOccId(card.name, j.output);
        setMessages(m => [
          ...m,
          { role: "tool", name: card.name, output: j.output },
          ...(occId ? [{ role: "panel_pick", occId }] : []),
        ]);
      }
    } catch (e) {
      setMessages(m => [...m, { role: "assistant", content: `(network error) ${String(e?.message || e)}` }]);
    } finally {
      setBusy(false);
    }
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
            {location && (
              <span
                title={`"here" / "this ${location.type}" resolves to ${location.label}`}
                style={{
                  fontSize: 9, opacity: 0.8, maxWidth: 130, overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap",
                  padding: "2px 6px", borderRadius: 999,
                  background: "rgba(110,180,130,0.16)", border: "1px solid rgba(110,180,130,0.3)",
                }}
              >📍 {location.type === "folder" ? "📁 " : ""}{location.label}</span>
            )}
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
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button
                  onClick={clearToken}
                  disabled={!token}
                  title="Forget the saved key — it'll reconnect automatically, or paste a new one"
                  style={{
                    fontSize: 10, padding: "3px 8px", borderRadius: 4, cursor: token ? "pointer" : "default",
                    background: "rgba(190,90,80,0.14)", color: "inherit", opacity: token ? 1 : 0.4,
                    border: "1px solid rgba(190,90,80,0.4)",
                  }}
                >Clear saved key</button>
              </div>
              <div style={{ fontSize: 9, opacity: 0.55, marginTop: 6, lineHeight: 1.5 }}>
                Your assistant key connects this chat to your workspace. It fills in
                automatically while you're signed in — you only need to paste one if asked.
              </div>
            </div>
          )}

          {/* Transcript */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {messages.length === 0 && (
              <div style={{ opacity: 0.65, fontSize: 11, padding: 8, lineHeight: 1.6 }}>
                <div style={{ marginBottom: 6, opacity: 0.85 }}>Try, for example:</div>
                {[
                  "wiki photosynthesis",
                  "search my fields",
                  "create a doc page from the Wikipedia article on Eminem",
                  location ? `add a folder called Research here` : "list my operations",
                ].map((ex) => (
                  <div
                    key={ex}
                    onClick={() => setInput(ex)}
                    style={{
                      cursor: "pointer", padding: "3px 7px", marginBottom: 3, borderRadius: 5,
                      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)",
                    }}
                  >{ex}</div>
                ))}
                <div style={{ marginTop: 6, opacity: 0.5, fontSize: 10 }}>
                  Full guide in <code>docs/assistant-guide.md</code>.
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <MessageBubble
                key={i}
                msg={m}
                busy={busy}
                onResolveConfirm={m.role === "confirm" ? (approve, editedInput) => resolveConfirm(i, approve, editedInput) : undefined}
              />
            ))}
            {busy && (
              <>
                {streamingText && (
                  <div style={{
                    alignSelf: "flex-start", maxWidth: "90%",
                    background: "rgba(255,255,255,0.06)", color: "inherit",
                    padding: "6px 10px", borderRadius: 8,
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>
                    {streamingText}<span style={{ opacity: 0.5 }}>▋</span>
                  </div>
                )}
                <ThinkingBar progress={progress} elapsedMs={elapsedMs} typical={typical} />
              </>
            )}
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

function MessageBubble({ msg, busy = false, onResolveConfirm }) {
  if (msg.role === "confirm") {
    return <ConfirmCard msg={msg} busy={busy} onResolve={onResolveConfirm} />;
  }
  if (msg.role === "_meta") {
    return (
      <div style={{ alignSelf: "center", fontSize: 9, opacity: 0.4 }}>
        ↳ {msg.mode}{msg.model ? ` · ${msg.model}` : ""}
      </div>
    );
  }
  if (msg.role === "tool") {
    return <ToolResultView name={msg.name} output={msg.output} />;
  }
  if (msg.role === "panel_pick") {
    return <PanelPickCard occId={msg.occId} />;
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

// Build the list of placeable locations (containers + pages) from the live
// store, and a label resolver. Lets the confirm card show + edit where a new
// item lands without the LLM having to produce a perfect id.
function useLocations() {
  const { occurrencesById, modulesById, state } = useGridActions();
  const curGridId = state?.grid?._id || state?.grid?.id || state?.gridId || null;
  return React.useMemo(() => {
    const occById = occurrencesById || {};
    const modById = modulesById || {};
    const options = [];
    for (const occ of Object.values(occById)) {
      // Keep the assistant scoped to the CURRENT grid only — never offer
      // (or best-guess) a container/page that lives in another grid.
      if (curGridId && occ.gridId && occ.gridId !== curGridId) continue;
      const mod = modById[occ.moduleId || occ.targetId];
      const role = mod?.role;
      if (role !== "container" && role !== "page") continue;
      if (!mod?.label) continue;
      options.push({ id: occ.id, label: mod.label, role });
    }
    options.sort((a, b) => a.label.localeCompare(b.label));
    const labelOf = (id) => {
      const occ = occById[id]; if (!occ) return null;
      if (curGridId && occ.gridId && occ.gridId !== curGridId) return null;
      return modById[occ.moduleId || occ.targetId]?.label || null;
    };
    return { options, labelOf };
  }, [occurrencesById, modulesById, curGridId]);
}

// Pick the best-guess location: if the LLM's parentId is a real id, use it;
// otherwise fuzzy-match its placeholder text (e.g. "<6:30pmcontainer-id>") and
// the item label against the option labels.
function bestGuessLocation(input, options, labelOf, userText = "") {
  if (input?.parentId && labelOf(input.parentId)) return input.parentId;
  // The destination (time / place) usually lives in the user's REQUEST, not in
  // the tool args — e.g. "put X in the 6:30pm container". Include userText in
  // the haystack so the longest-label match lands on "6:30pm container" instead
  // of the item label "testing ai" fuzzily hitting a container named "Test".
  const hay = `${userText || ""} ${input?.parentId || ""} ${input?.label || ""}`.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!hay) return "";
  let best = "", bestLen = 0;
  for (const o of options) {
    const norm = o.label.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (norm && hay.includes(norm) && norm.length > bestLen) { best = o.id; bestLen = norm.length; }
  }
  return best;
}

// Noisy plumbing args the user doesn't need to see on a confirm card.
const HIDDEN_ARG_KEYS = new Set(["gridId", "dryRun", "userId"]);

// Field types the create_field confirm card lets the user pick (mirrors the
// Field model's type enum + the create_field tool description).
const FIELD_TYPES = ["number", "text", "boolean", "select", "date", "duration", "rating", "occurrence"];

// "parentId" → "parent", "fieldId" → "field", "moduleId" → "module".
function prettyArgKey(k) {
  return k.replace(/Id$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

// Render a confirm-card arg value readably: resolve id-shaped values to their
// label/name from the live store; summarize objects/arrays instead of dumping JSON.
function friendlyArgValue(key, val, { occurrencesById, modulesById, fieldsById }) {
  if (val == null || val === "") return "—";
  if (typeof val === "object") {
    const n = Array.isArray(val) ? val.length : Object.keys(val).length;
    return Array.isArray(val) ? `${n} item${n === 1 ? "" : "s"}` : `${n} field${n === 1 ? "" : "s"}`;
  }
  if (typeof val === "string") {
    if (/parent|occurrence|target/i.test(key)) {
      const occ = occurrencesById?.[val];
      const lbl = (occ && modulesById?.[occ.moduleId || occ.targetId]?.label) || modulesById?.[val]?.label;
      if (lbl) return lbl;
    }
    if (/field/i.test(key)) { const f = fieldsById?.[val]?.name; if (f) return f; }
    if (/module/i.test(key)) { const m = modulesById?.[val]?.label; if (m) return m; }
  }
  return String(val);
}

// Approval card for a confirmable action. For create_occurrence it shows an
// editable LOCATION picker (best-guess pre-filled) so the user confirms/corrects
// where the item goes — using the UI — before it's placed.
function ConfirmCard({ msg, busy, onResolve }) {
  const pending = msg.status === "pending";
  const isCreate = msg.name === "create_occurrence";
  const isWiki = msg.name === "wikipedia_import";
  const isCreatePage = msg.name === "create_module" && msg.input?.role === "page";
  const isCreateField = msg.name === "create_field";
  const isImportBatch = msg.name === "wikipedia_import_batch";
  const batchTitles = useMemo(
    () => (Array.isArray(msg.input?.titles) ? msg.input.titles.filter(Boolean) : []), [msg.input?.titles]);
  const [picked, setPicked] = useState(() => new Set(batchTitles));
  const wikiTitle = msg.input?.title || msg.input?.query || "";
  const { options, labelOf } = useLocations();
  const { occurrencesById, modulesById, fieldsById } = useGridActions();
  const [parentId, setParentId] = useState(() => (isCreate ? bestGuessLocation(msg.input, options, labelOf, msg.userText) : null));
  const [filter, setFilter] = useState("");
  const [wiki, setWiki] = useState(null);     // { title, extract, thumbnail, url }
  const [wikiErr, setWikiErr] = useState(false);
  const [pageKind, setPageKind] = useState(msg.input?.kind || "doc");
  // create_field: editable name/type/unit before Approve.
  const [fieldName, setFieldName] = useState(msg.input?.name || "");
  const [fieldType, setFieldType] = useState(() =>
    FIELD_TYPES.includes(msg.input?.type) ? msg.input.type : "number");
  const [fieldUnit, setFieldUnit] = useState(msg.input?.unit || "");

  // Preview the Wikipedia article (title + thumbnail + extract) so the user can
  // confirm it's the right one before importing.
  useEffect(() => {
    if (!isWiki || !pending || !wikiTitle) return;
    let cancelled = false;
    (async () => {
      try {
        const tok = localStorage.getItem(STORAGE_KEY) || "";
        const r = await fetch(`/api/v1/research/wikipedia/summary?title=${encodeURIComponent(wikiTitle)}`,
          { headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
        const j = await r.json();
        if (cancelled) return;
        if (r.ok && j?.ok !== false) setWiki(j); else setWikiErr(true);
      } catch { if (!cancelled) setWikiErr(true); }
    })();
    return () => { cancelled = true; };
  }, [isWiki, pending, wikiTitle]);

  const verb = isCreate ? "Create item" : isWiki ? "Import Wikipedia article"
    : isImportBatch ? `Import ${picked.size} Wikipedia page${picked.size === 1 ? "" : "s"}`
    : isCreateField ? "Create field" : String(msg.name || "action").replace(/_/g, " ");
  const itemLabel = msg.input?.label || msg.input?.moduleId || "new item";
  const approve = () => onResolve?.(true,
    isCreate ? { ...msg.input, parentId: parentId || undefined }
    : isCreatePage ? { ...msg.input, kind: pageKind }
    : isCreateField ? { ...msg.input, name: fieldName.trim(), type: fieldType, unit: fieldUnit.trim() || undefined }
    : isImportBatch ? { ...msg.input, titles: batchTitles.filter(t => picked.has(t)) }
    : msg.input);

  const shown = filter
    ? options.filter(o => o.label.toLowerCase().includes(filter.toLowerCase())).slice(0, 8)
    : options.slice(0, 8);

  return (
    <div style={{
      alignSelf: "stretch", fontSize: 11,
      background: "rgba(220,150,90,0.10)", border: "1px solid rgba(220,150,90,0.35)",
      borderRadius: 6, padding: "8px 10px",
    }}>
      <div style={{ fontWeight: 600, color: "rgb(230,170,110)", marginBottom: 4 }}>
        ⚠ Confirm: <span style={{ fontFamily: "inherit" }}>{verb}</span>
      </div>

      {isCreate ? (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 11, marginBottom: 4 }}>Create <b>“{itemLabel}”</b> in:</div>
          <div style={{
            fontSize: 11, padding: "3px 7px", borderRadius: 4, marginBottom: 4,
            background: parentId ? "rgba(110,180,130,0.16)" : "rgba(190,90,80,0.16)",
            border: `1px solid ${parentId ? "rgba(110,180,130,0.4)" : "rgba(190,90,80,0.4)"}`,
          }}>
            📍 {parentId ? labelOf(parentId) : "— pick a location —"}
          </div>
          {pending && (
            <>
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="search containers / pages…"
                style={{
                  width: "100%", padding: 5, fontSize: 11, fontFamily: "inherit", marginBottom: 3,
                  background: "var(--input-bg, #14171c)", color: "inherit",
                  border: "1px solid var(--border-default, rgba(255,255,255,0.12))", borderRadius: 4,
                }}
              />
              <div style={{ maxHeight: 120, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
                {shown.map((o) => (
                  <div
                    key={o.id}
                    onClick={() => setParentId(o.id)}
                    style={{
                      cursor: "pointer", padding: "3px 7px", borderRadius: 4, fontSize: 11,
                      background: o.id === parentId ? "rgba(110,180,130,0.22)" : "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.07)",
                    }}
                  >{o.label} <span style={{ opacity: 0.45, fontSize: 9 }}>{o.role}</span></div>
                ))}
                {shown.length === 0 && <div style={{ opacity: 0.5, fontSize: 10 }}>No matches.</div>}
              </div>
            </>
          )}
        </div>
      ) : isWiki ? (
        <div style={{ marginBottom: 6 }}>
          {wiki ? (
            <div style={{ display: "flex", gap: 8 }}>
              {wiki.thumbnail && (
                <img src={wiki.thumbnail} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />
              )}
              <div style={{ minWidth: 0 }}>
                <a
                  href={wiki.url} target="_blank" rel="noopener noreferrer"
                  style={{ fontWeight: 600, color: "rgb(130,180,250)", textDecoration: "none" }}
                  title="Open the Wikipedia page in a new tab"
                >{wiki.title} ↗</a>
                <div style={{ fontSize: 10, opacity: 0.75, marginTop: 2, maxHeight: 72, overflow: "hidden", lineHeight: 1.45 }}>
                  {wiki.extract}
                </div>
              </div>
            </div>
          ) : wikiErr ? (
            <div style={{ fontSize: 10, opacity: 0.7 }}>
              Couldn’t load a preview for “{wikiTitle}”.{" "}
              <a href={`https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle.replace(/ /g, "_"))}`}
                 target="_blank" rel="noopener noreferrer"
                 style={{ color: "rgb(130,180,250)" }}>Open on Wikipedia ↗</a>{" "}— import anyway?
            </div>
          ) : (
            <div style={{ fontSize: 10, opacity: 0.6 }}>Loading preview for “{wikiTitle}”…</div>
          )}
        </div>
      ) : isCreatePage ? (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 11, marginBottom: 5 }}>New <b>“{msg.input?.label || "page"}”</b> — what kind of page?</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {["doc", "board", "canvas", "table"].map((k) => (
              <button
                key={k}
                onClick={() => setPageKind(k)}
                style={{
                  fontSize: 11, padding: "3px 9px", borderRadius: 4, cursor: "pointer", textTransform: "capitalize",
                  background: k === pageKind ? "rgba(110,180,130,0.22)" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${k === pageKind ? "rgba(110,180,130,0.5)" : "rgba(255,255,255,0.12)"}`,
                  color: "inherit",
                }}
              >{k}</button>
            ))}
          </div>
          <div style={{ fontSize: 9, opacity: 0.55, marginTop: 5, lineHeight: 1.4 }}>
            {pageKind === "doc" ? "Document — write-ups / articles / notes."
              : pageKind === "board" ? "Board — kanban columns of containers."
              : pageKind === "canvas" ? "Canvas — free-form / drawing / mind-map."
              : "Table — spreadsheet grid."}
          </div>
        </div>
      ) : isImportBatch ? (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 11, marginBottom: 5 }}>
            Import these as doc pages (links between them become in-app navigation):
          </div>
          {pending ? (
            <div style={{ maxHeight: 160, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
              {batchTitles.map((t) => {
                const on = picked.has(t);
                return (
                  <label key={t} style={{
                    display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                    padding: "3px 7px", borderRadius: 4, fontSize: 11,
                    background: on ? "rgba(110,180,130,0.16)" : "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.07)",
                  }}>
                    <input
                      type="checkbox" checked={on}
                      onChange={() => setPicked((prev) => {
                        const next = new Set(prev);
                        if (next.has(t)) next.delete(t); else next.add(t);
                        return next;
                      })}
                    />
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t}</span>
                  </label>
                );
              })}
              {batchTitles.length === 0 && <div style={{ opacity: 0.5, fontSize: 10 }}>No titles provided.</div>}
            </div>
          ) : (
            <div style={{ fontSize: 11, opacity: 0.9 }}>{picked.size} page{picked.size === 1 ? "" : "s"}</div>
          )}
        </div>
      ) : isCreateField ? (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 11, marginBottom: 5 }}>New field — confirm or edit:</div>
          {pending ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 10, opacity: 0.7 }}>Name
                <input
                  value={fieldName}
                  onChange={(e) => setFieldName(e.target.value)}
                  placeholder="field name"
                  style={{
                    width: "100%", marginTop: 2, padding: 5, fontSize: 11, fontFamily: "inherit",
                    background: "var(--input-bg, #14171c)", color: "inherit",
                    border: "1px solid var(--border-default, rgba(255,255,255,0.12))", borderRadius: 4,
                  }}
                />
              </label>
              <label style={{ fontSize: 10, opacity: 0.7 }}>Type
                <select
                  value={fieldType}
                  onChange={(e) => setFieldType(e.target.value)}
                  style={{
                    width: "100%", marginTop: 2, padding: 5, fontSize: 11, fontFamily: "inherit",
                    background: "var(--input-bg, #14171c)", color: "inherit",
                    border: "1px solid var(--border-default, rgba(255,255,255,0.12))", borderRadius: 4,
                  }}
                >
                  {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 10, opacity: 0.7 }}>Unit <span style={{ opacity: 0.6 }}>(optional)</span>
                <input
                  value={fieldUnit}
                  onChange={(e) => setFieldUnit(e.target.value)}
                  placeholder="e.g. g, min, $"
                  style={{
                    width: "100%", marginTop: 2, padding: 5, fontSize: 11, fontFamily: "inherit",
                    background: "var(--input-bg, #14171c)", color: "inherit",
                    border: "1px solid var(--border-default, rgba(255,255,255,0.12))", borderRadius: 4,
                  }}
                />
              </label>
            </div>
          ) : (
            <div style={{ fontSize: 11, opacity: 0.9 }}>
              <b>{fieldName || "(unnamed)"}</b> · {fieldType}{fieldUnit ? ` · ${fieldUnit}` : ""}
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginBottom: 6, fontSize: 10 }}>
          {msg.description && (
            <div style={{ opacity: 0.7, marginBottom: 5, lineHeight: 1.45 }}>{msg.description}</div>
          )}
          {Object.entries(msg.input || {}).filter(([k]) => !HIDDEN_ARG_KEYS.has(k)).map(([k, v]) => (
            <div key={k} style={{ opacity: 0.9, wordBreak: "break-word" }}>
              <span style={{ opacity: 0.5 }}>{prettyArgKey(k)}: </span>
              {friendlyArgValue(k, v, { occurrencesById, modulesById, fieldsById })}
            </div>
          ))}
        </div>
      )}

      {pending ? (
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={approve}
            disabled={busy || (isCreate && !parentId) || (isCreateField && !fieldName.trim()) || (isImportBatch && picked.size === 0)}
            title={isCreate && !parentId ? "Pick a location first"
              : isCreateField && !fieldName.trim() ? "Name the field first"
              : isImportBatch && picked.size === 0 ? "Select at least one page" : ""}
            style={{
              padding: "4px 12px", fontSize: 11, borderRadius: 4, border: "none",
              cursor: busy ? "wait" : "pointer",
              background: "rgb(90,160,110)", color: "white",
              opacity: (busy || (isCreate && !parentId) || (isCreateField && !fieldName.trim()) || (isImportBatch && picked.size === 0)) ? 0.4 : 1,
            }}
          >Approve</button>
          <button
            onClick={() => onResolve?.(false)}
            disabled={busy}
            style={{
              padding: "4px 12px", fontSize: 11, borderRadius: 4, cursor: busy ? "wait" : "pointer",
              background: "transparent", color: "inherit", border: "1px solid rgba(255,255,255,0.2)", opacity: busy ? 0.5 : 1,
            }}
          >Decline</button>
        </div>
      ) : (
        <div style={{ fontSize: 10, opacity: 0.65 }}>
          {msg.status === "approved" ? "✓ Approved" : "✕ Declined"}
        </div>
      )}
    </div>
  );
}

// Pull the occurrence id of freshly created/imported content out of a tool
// result, so the panel picker can offer to show it. create_occurrence returns
// `{ occurrence }` (object or id); the importers return `{ rootOccurrenceId }`.
// True for the single-root importer tools whose output is `{ rootOccurrenceId }`
// (the batch importer has its own `{ imported: [...] }` branch). Used so an import
// always gets wrapped into the shared "Imports" folder, not left loose at root.
function isImportTool(name) {
  return ["wikipedia_import", "import_markdown", "import_html", "import_text"].includes(name);
}

function extractCreatedOccId(name, output) {
  if (!output || typeof output !== "object" || output.error || output.ok === false) return null;
  if (output.occurrence) {
    return typeof output.occurrence === "string" ? output.occurrence : (output.occurrence.id || null);
  }
  return output.rootOccurrenceId || output.pageOccurrenceId || output.occurrenceId || null;
}

// "Show it in a panel?" — the grid-map picker (Option 1). The new item is
// usually a LEAF (an instance dropped into a Schedule slot), so the picker
// targets the new item's ANCESTOR PAGE (e.g. Schedule), not the item itself:
//   - If that page is already visible in a panel → no prompt; immediately
//     scroll + highlight the new item where it is.
//   - Otherwise → ask which panel; open the page there, then scroll + highlight.
// Resolves everything live from the store so it self-gates as the socket-created
// occurrence + its parent linkage arrive. A created PAGE targets itself; an
// imported container with no ancestor page is wrapped in a board page tab.
function PanelPickCard({ occId }) {
  const { occurrencesById, modulesById, viewsById, manifestsById, foldersById, state, dispatch, socket } = useGridActions();
  const grid = state?.grid;
  const curGridId = grid?._id || grid?.id || state?.gridId || null;
  const [done, setDone] = useState(null); // "__scrolled__" | "<panel label>" | null
  const [dismissed, setDismissed] = useState(false);

  const occ = occurrencesById?.[occId] || null;
  const mod = occ ? modulesById?.[occ.moduleId || occ.targetId] : null;
  const role = mod?.role;

  // Walk up the occurrences[] tree (parentId as fallback) to the nearest
  // ancestor PAGE — inclusive, so a created page resolves to itself.
  const pageOcc = useMemo(() => {
    if (!occ) return null;
    const occById = occurrencesById || {};
    const parentByChild = {};
    for (const o of Object.values(occById)) {
      for (const childId of (o.occurrences || [])) {
        if (childId && !(childId in parentByChild)) parentByChild[childId] = o.id;
      }
    }
    let cur = occId;
    const seen = new Set();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const o = occById[cur];
      if (!o) break;
      const m = modulesById?.[o.moduleId || o.targetId];
      if (m?.role === "page") return o;
      cur = parentByChild[cur] ?? o.parentId ?? null;
    }
    return null;
  }, [occ, occId, occurrencesById, modulesById]);

  const pageMod = pageOcc ? modulesById?.[pageOcc.moduleId || pageOcc.targetId] : null;
  const targetLabel = pageMod?.label || mod?.label || "the new item";

  // Map each grid cell that hosts a panel → its occurrence id + label.
  const { rows, cols, panelAt } = useMemo(() => {
    const rows = grid?.rows ?? 1, cols = grid?.cols ?? 1;
    const panelAt = {};
    for (const o of Object.values(occurrencesById || {})) {
      if (curGridId && o.gridId && o.gridId !== curGridId) continue;
      const m = modulesById?.[o.moduleId || o.targetId];
      if (m?.role !== "panel") continue;
      const r = o.placement?.row ?? o.panel?.row ?? 0;
      const c = o.placement?.col ?? o.panel?.col ?? 0;
      panelAt[`${r}:${c}`] = { occId: o.id, label: m.label || "Panel" };
    }
    return { rows, cols, panelAt };
  }, [grid, occurrencesById, modulesById, curGridId]);

  // Is the ancestor page already the active tab of some panel's view?
  const alreadyVisible = useMemo(() => {
    if (!pageOcc) return false;
    for (const v of Object.values(viewsById || {})) {
      if (v?.activeOccurrenceId === pageOcc.id) return true;
    }
    return false;
  }, [viewsById, pageOcc]);

  // Already on-screen → don't prompt; just scroll + highlight the new item.
  useEffect(() => {
    if (done || dismissed) return;
    if (!occ || !pageOcc || !alreadyVisible) return;
    jumpToOccurrence(occId);
    setDone("__scrolled__");
  }, [done, dismissed, occ, pageOcc, alreadyVisible, occId]);

  function openInPanel(r, c) {
    const panel = panelAt[`${r}:${c}`];
    const panelOcc = panel && occurrencesById?.[panel.occId];
    if (!panelOcc) return;
    const userId = occ.userId || mod?.userId;
    const gridId = occ.gridId || curGridId;

    if (pageOcc) {
      // Pin the real ancestor page as a tab here, activate it, scroll to the
      // item. Shared with the panel header search — one implementation.
      openOccurrenceInPanel({
        occId, panelOccurrence: panelOcc, occurrencesById, modulesById, viewsById, dispatch, socket,
      });
    } else {
      // No ancestor page (e.g. an imported container at root) — wrap it in a
      // DOC page (multi-parented; content stays where it was created), parented
      // under a dedicated "Imports" folder so it lands grouped in the panel's
      // Local tree instead of as a loose root page.
      const pageOccId = createImportsDocPage({
        rootOccId: occId, panelOccurrenceId: panelOcc.id, grid,
        manifests: Object.values(manifestsById || {}),
        folders: Object.values(foldersById || {}),
        occurrencesById,
        dispatch, socket, userId, label: mod?.label,
      });
      const panelMod = modulesById?.[panelOcc.moduleId || panelOcc.targetId];
      const viewId = panelOcc.viewId || panelMod?.viewId;
      const view = viewId ? viewsById?.[viewId] : null;
      if (view) {
        CommitHelpers.updateView({ dispatch, socket, view: { ...view, activeOccurrenceId: pageOccId }, emit: true });
      }
      setTimeout(() => jumpToOccurrence(occId), 300);
    }
    setDone(panel.label);
  }

  if (dismissed) return null;
  if (done === "__scrolled__") {
    return (
      <div style={{ alignSelf: "flex-start", fontSize: 10, opacity: 0.7, padding: "2px 4px" }}>
        ✓ Scrolled to the new item on “{targetLabel}”
      </div>
    );
  }
  if (done) {
    return (
      <div style={{ alignSelf: "flex-start", fontSize: 10, opacity: 0.7, padding: "2px 4px" }}>
        ✓ Opened “{targetLabel}” in {done}
      </div>
    );
  }
  // Wait until the occ is in the store; only surface page-hosted or container
  // content; the already-visible case is handled by the effect above.
  if (!occ || (!pageOcc && role !== "container") || alreadyVisible) return null;

  return (
    <div style={{
      alignSelf: "stretch", fontSize: 11,
      background: "rgba(90,140,200,0.10)", border: "1px solid rgba(90,140,200,0.32)",
      borderRadius: 6, padding: "8px 10px",
    }}>
      <div style={{ marginBottom: 6 }}>Show <b>“{targetLabel}”</b> in a panel?</div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <MiniGridMap
          rows={rows}
          cols={cols}
          activeRow={-1}
          activeCol={-1}
          cellSize={22}
          onCellClick={openInPanel}
          enabledCell={(r, c) => !!panelAt[`${r}:${c}`]}
        />
        <button
          onClick={() => setDismissed(true)}
          style={{
            fontSize: 10, padding: "3px 8px", borderRadius: 4, cursor: "pointer",
            background: "transparent", color: "inherit", border: "1px solid rgba(255,255,255,0.2)",
          }}
        >Don't show</button>
      </div>
      <div style={{ fontSize: 9, opacity: 0.5, marginTop: 5 }}>Click the panel where it should open.</div>
    </div>
  );
}

// Friendly per-tool result card. Detects the common result shapes the grid
// tools return (search hits, import stats, lists, created entities, grid/filter
// changes) and renders a readable summary; raw JSON stays one click away.
function ToolResultView({ name, output }) {
  const prettyName = String(name || "tool").replace(/_/g, " ");
  const body = renderToolBody(name, output);
  return (
    <div style={{
      alignSelf: "flex-start", maxWidth: "92%", fontSize: 11,
      background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 6, padding: "6px 8px",
    }}>
      <div style={{ fontSize: 9, opacity: 0.55, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: body ? 4 : 0 }}>
        {prettyName}
      </div>
      {body}
      <details style={{ marginTop: body ? 5 : 2 }}>
        <summary style={{ cursor: "pointer", fontSize: 9, opacity: 0.5 }}>raw</summary>
        <pre style={{ margin: "4px 0 0", maxHeight: 160, overflow: "auto", fontSize: 10, opacity: 0.8 }}>
          {safeJson(output)}
        </pre>
      </details>
    </div>
  );
}

function renderToolBody(name, output) {
  if (output == null) return <div style={{ opacity: 0.6 }}>(no result)</div>;
  if (output.error || output.ok === false) {
    return <div style={{ color: "rgb(230,140,140)" }}>✗ {String(output.error || output.message || "failed")}</div>;
  }

  // Wikipedia search → list of titles + descriptions.
  const results = Array.isArray(output.results) ? output.results : null;
  if (results) {
    if (results.length === 0) return <div style={{ opacity: 0.6 }}>No matches.</div>;
    return (
      <ul style={{ margin: 0, paddingLeft: 14 }}>
        {results.slice(0, 8).map((r, i) => (
          <li key={i} style={{ marginBottom: 2 }}>
            <span style={{ fontWeight: 600 }}>{r.title || r.label || r.name || String(r)}</span>
            {r.description && <span style={{ opacity: 0.6 }}> — {r.description}</span>}
          </li>
        ))}
      </ul>
    );
  }

  // Batch Wikipedia import → summary of imported pages (+ relink count).
  if (Array.isArray(output.imported)) {
    const ok = output.imported.length;
    const failed = Array.isArray(output.failed) ? output.failed.length : 0;
    return (
      <div>
        <div>✓ Imported {ok} page{ok === 1 ? "" : "s"}{output.relinked ? ` · relinked ${output.relinked} link${output.relinked === 1 ? "" : "s"}` : ""}.</div>
        <ul style={{ margin: "2px 0 0", paddingLeft: 14 }}>
          {output.imported.slice(0, 12).map((it, i) => <li key={i}>{it.title || it.rootOccurrenceId}</li>)}
        </ul>
        {failed > 0 && <div style={{ color: "rgb(220,150,120)", fontSize: 10, marginTop: 2 }}>{failed} failed.</div>}
        <div style={{ opacity: 0.5, fontSize: 10, marginTop: 2 }}>Grouped under the “Imports” folder.</div>
      </div>
    );
  }

  // Import stats (markdown / html / wikipedia import).
  if (output.stats && typeof output.stats === "object") {
    const parts = Object.entries(output.stats)
      .filter(([, v]) => typeof v === "number" && v > 0)
      .map(([k, v]) => `${v} ${k}`);
    return (
      <div>
        <div>✓ Imported{(() => {
          const s = output.source;
          if (!s) return "";
          const label = typeof s === "string" ? s : (s.title || s.label || s.name || s.url || null);
          return label ? ` from ${label}` : "";
        })()}.</div>
        {parts.length > 0 && <div style={{ opacity: 0.7 }}>{parts.join(" · ")}</div>}
        <div style={{ opacity: 0.5, fontSize: 10, marginTop: 2 }}>Refresh the grid to see it.</div>
      </div>
    );
  }

  // Plain list (list_operations / list_occurrences / list_folders / list_views …).
  const list = Array.isArray(output) ? output : (Array.isArray(output.items) ? output.items : null);
  if (list) {
    if (list.length === 0) return <div style={{ opacity: 0.6 }}>Empty.</div>;
    return (
      <div>
        <ul style={{ margin: 0, paddingLeft: 14 }}>
          {list.slice(0, 10).map((it, i) => (
            <li key={i}>{it?.name || it?.label || it?.title || it?.id || String(it)}</li>
          ))}
        </ul>
        {list.length > 10 && <div style={{ opacity: 0.5, fontSize: 10 }}>+{list.length - 10} more</div>}
      </div>
    );
  }

  // Created / updated a single entity.
  const ent = output.module || output.occurrence || output.field || output.operation || output.folder || output.view || output.manifest;
  if (ent && typeof ent === "object") {
    const label = ent.name || ent.label || ent.title || ent.id;
    const kind = [ent.role, ent.kind, ent.type].filter(Boolean).join("/");
    return <div>✓ {label}{kind ? <span style={{ opacity: 0.6 }}> ({kind})</span> : null}</div>;
  }

  // Grid / filter change.
  if (output.grid && typeof output.grid === "object") {
    return <div>✓ Updated grid settings.</div>;
  }

  // Template apply / generic ok with counts.
  if (output.ok === true || output.rootOccurrenceId) {
    const n = Array.isArray(output.newOccurrenceIds) ? output.newOccurrenceIds.length : null;
    return <div>✓ Done{n != null ? ` — ${n} new item${n === 1 ? "" : "s"}` : ""}.</div>;
  }

  // Fallback — a short summary key if present, else nothing (raw is below).
  if (typeof output.summary === "string") return <div>{output.summary}</div>;
  return null;
}

function safeJson(v) {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

// Progress bar for the "thinking" wait. The local model is slow, so this shows
// a live elapsed counter + an ETA learned from recent runs (median), and a
// determinate bar that reaches ~90% at the typical time then crawls toward 97%
// (never "done" until the response actually lands).
function ThinkingBar({ progress, elapsedMs, typical }) {
  // Past the learned ETA (or ~30s with no history) the estimate is meaningless —
  // this run is an outlier (e.g. a multi-step tool call). Don't freeze near 100%
  // with a wrong ETA; switch to an honest indeterminate (sliding) bar.
  const overrun = typical ? elapsedMs > typical : elapsedMs > 30000;
  const frac = typical && typical > 0
    ? Math.min(0.97, 1 - Math.exp(-2.3 * (elapsedMs / typical)))
    : Math.min(0.95, 1 - Math.exp(-elapsedMs / 18000));
  const sec = Math.round(elapsedMs / 1000);
  const eta = typical && !overrun ? ` / ~${Math.round(typical / 1000)}s` : "";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, opacity: 0.6 }}>
        <span>{overrun ? `${formatProgress(progress)} · still working` : formatProgress(progress)}</span>
        <span>{sec}s{eta}</span>
      </div>
      <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.08)", overflow: "hidden", position: "relative" }}>
        {overrun ? (
          <div className="assistant-indeterminate" style={{
            position: "absolute", top: 0, bottom: 0, width: "35%", borderRadius: 2,
            background: "rgba(110,170,230,0.85)",
          }} />
        ) : (
          <div style={{
            height: "100%", width: `${(frac * 100).toFixed(1)}%`,
            background: "rgba(110,170,230,0.85)", transition: "width 0.2s linear",
          }} />
        )}
      </div>
    </div>
  );
}

// Turn a server progress event into a human status line under the busy spinner.
function formatProgress(p) {
  if (!p) return "… thinking";
  if (p.phase === "tool" || p.phase === "tool_done") {
    return `… running ${String(p.tool || "").replace(/_/g, " ")}`;
  }
  if (p.phase === "thinking") {
    return p.iteration > 1 ? `… thinking (step ${p.iteration})` : "… thinking";
  }
  return "… thinking";
}

const iconBtn = {
  background: "transparent", color: "inherit", border: "none", cursor: "pointer",
  padding: "2px 6px", fontSize: 14, opacity: 0.7,
};
