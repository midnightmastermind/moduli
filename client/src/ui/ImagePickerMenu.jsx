// ui/ImagePickerMenu.jsx
// ============================================================
// Reusable image picker — the Calibre "download cover" pattern.
// Three ways to supply an image, in one modal:
//   • Search — keyless web image search (server proxy /api/images/search:
//     DuckDuckGo primary, Wikipedia fallback). Query prefills from the
//     subject's label; results render as a thumbnail grid; click = pick.
//   • Upload — file from disk via /api/images/upload (bare upload: stores
//     the file + returns its /uploads URL, mints no module/occurrence).
//   • URL — paste a direct image link.
//
// The picked value is always a URL string handed to `onPick(url)` — callers
// decide where it lands (media-role field value, module.fileRef, …).
// Mounted from: OccurrenceOption rows (movie/person dropdown), media-role
// field inputs (Field.jsx), and the artifact image viewer.
// ============================================================
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, Upload, Link2, X, Loader2, ImageOff } from "lucide-react";
import LoadingImage from "./LoadingImage.jsx";

// ── Imperative controller ────────────────────────────────────────────────
// Call sites live inside popovers/dropdowns that unmount on outside clicks —
// if each rendered its own <ImagePickerMenu>, the modal would vanish with
// its host. Instead ONE <ImagePickerHost> is mounted in App; call sites use
// `openImagePicker({ query, title, onPick })` (ContextMenu-portal spirit,
// imperative flavor). The onPick closure carries the caller's commit context.
let _hostListener = null;
export function registerImagePickerHost(fn) {
  _hostListener = fn;
  return () => { if (_hostListener === fn) _hostListener = null; };
}
export function openImagePicker(request) {
  if (!_hostListener) {
    console.warn("[ImagePicker] no host mounted — is <ImagePickerHost/> in App?");
    return;
  }
  _hostListener(request);
}

export function ImagePickerHost() {
  const [req, setReq] = useState(null);
  useEffect(() => registerImagePickerHost((r) => setReq(r || null)), []);
  return (
    <ImagePickerMenu
      open={!!req}
      onClose={() => setReq(null)}
      onPick={(url) => { req?.onPick?.(url); }}
      initialQuery={req?.query || ""}
      title={req?.title || "Set image"}
    />
  );
}

const TABS = [
  { id: "search", label: "Search", Icon: Search },
  { id: "upload", label: "Upload", Icon: Upload },
  { id: "url", label: "URL", Icon: Link2 },
];

export default function ImagePickerMenu({
  open,
  onClose,
  onPick,           // (url: string) => void — caller commits + closes as needed
  initialQuery = "",
  title = "Set image",
}) {
  const [tab, setTab] = useState("search");
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState(null); // null = not searched yet
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [urlDraft, setUrlDraft] = useState("");
  const fileRef = useRef(null);
  const searchedOnceRef = useRef(false);

  // Fresh open → reset to the new subject's query and auto-search it
  // (Calibre behavior: opening the dialog immediately looks up covers).
  useEffect(() => {
    if (!open) return;
    setTab("search");
    setQuery(initialQuery);
    setResults(null);
    setError(null);
    setUrlDraft("");
    searchedOnceRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && initialQuery && !searchedOnceRef.current) {
      searchedOnceRef.current = true;
      runSearch(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialQuery]);

  async function runSearch(q) {
    const term = (q ?? query).trim();
    if (!term) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/images/search?q=${encodeURIComponent(term)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message || j?.error || `search failed (${r.status})`);
      setResults(j.results || []);
    } catch (e) {
      setError(String(e.message || e));
      setResults([]);
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(file) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/images/upload", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `upload failed (${r.status})`);
      onPick?.(j.url);
      onClose?.();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const surface = {
    background: "var(--surface-overlay, #16202b)",
    border: "1px solid hsl(var(--border, 0 0% 25%))",
    borderRadius: 10,
    color: "var(--text-primary, #e5edf5)",
    boxShadow: "var(--menu-shadow-3)",
  };

  return createPortal(
    <div
      data-image-picker
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose?.(); }}
      onContextMenu={(e) => e.stopPropagation()}
      style={{
        position: "fixed", inset: 0, zIndex: 12000,
        background: "var(--scrim)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div style={{ ...surface, width: 560, maxWidth: "94vw", maxHeight: "82vh", display: "flex", flexDirection: "column" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid hsl(var(--border, 0 0% 25%))" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 4 }}>
            <X size={15} />
          </button>
        </div>

        {/* tabs */}
        <div style={{ display: "flex", gap: 4, padding: "8px 14px 0" }}>
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 12px", fontSize: 12, cursor: "pointer",
                borderRadius: 6, border: "1px solid",
                borderColor: tab === id ? "var(--accent-blue-border, #3b82f6)" : "transparent",
                background: tab === id ? "var(--accent-blue-bg, rgba(59,130,246,0.15))" : "transparent",
                color: "inherit",
              }}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>

        {/* body */}
        <div style={{ padding: 14, overflowY: "auto", minHeight: 180 }}>
          {tab === "search" && (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
                  placeholder="Search the web for an image…"
                  autoFocus
                  style={{
                    flex: 1, padding: "7px 10px", fontSize: 12.5,
                    background: "var(--input-bg, rgba(255,255,255,0.05))",
                    border: "1px solid hsl(var(--border, 0 0% 25%))",
                    borderRadius: 6, color: "inherit", outline: "none",
                  }}
                />
                <button
                  onClick={() => runSearch()}
                  disabled={busy}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "7px 14px",
                    fontSize: 12.5, cursor: "pointer", borderRadius: 6,
                    border: "1px solid var(--accent-blue-border, #3b82f6)",
                    background: "var(--accent-blue-bg, rgba(59,130,246,0.15))", color: "inherit",
                  }}
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Search
                </button>
              </div>

              {error && <div style={{ fontSize: 12, color: "var(--accent-red-text, #fca5a5)", marginBottom: 8 }}>{error}</div>}

              {results !== null && !busy && results.length === 0 && !error && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, opacity: 0.6, padding: 20, justifyContent: "center" }}>
                  <ImageOff size={14} /> No images found — try different words.
                </div>
              )}

              {results?.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8 }}>
                  {results.map((r, i) => (
                    <button
                      key={i}
                      title={r.title || r.image}
                      onClick={() => { onPick?.(r.image); onClose?.(); }}
                      style={{
                        padding: 0, cursor: "pointer", borderRadius: 6, overflow: "hidden",
                        border: "1px solid hsl(var(--border, 0 0% 25%))",
                        background: "var(--input-bg, rgba(255,255,255,0.04))",
                        aspectRatio: "2 / 3", display: "block",
                      }}
                    >
                      {/* The bare <img> here rendered its ALT — the search
                          result's TITLE — as placeholder text for the whole
                          fetch, which is what the user saw instead of a loading
                          circle. Search thumbnails come from arbitrary remote
                          hosts, so that window is long and some never resolve.
                          The tile already reserves its box (`aspectRatio: 2/3`
                          on the button), so only the STATUS needed fixing; the
                          wrapper takes that box so the spinner centres on the
                          picture rather than on whatever positioned ancestor
                          `display: contents` would have resolved against. */}
                      <LoadingImage
                        src={r.thumbnail || r.image}
                        alt={r.title || ""}
                        title={r.title || undefined}
                        spinnerSize="sm"
                        frameStyle={{ position: "relative", display: "block", width: "100%", height: "100%" }}
                        imgStyle={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === "upload" && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]); }}
              onClick={() => fileRef.current?.click()}
              style={{
                border: "2px dashed hsl(var(--border, 0 0% 30%))", borderRadius: 8,
                padding: "38px 20px", textAlign: "center", cursor: "pointer", fontSize: 12.5, opacity: busy ? 0.5 : 0.85,
              }}
            >
              <input
                ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              {busy
                ? <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Loader2 size={14} className="animate-spin" /> Uploading…</span>
                : <><Upload size={18} style={{ display: "block", margin: "0 auto 8px" }} />Click or drop an image file here</>}
              {error && <div style={{ fontSize: 12, color: "var(--accent-red-text, #fca5a5)", marginTop: 10 }}>{error}</div>}
            </div>
          )}

          {tab === "url" && (
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && urlDraft.trim()) { onPick?.(urlDraft.trim()); onClose?.(); } }}
                placeholder="https://…/image.jpg"
                autoFocus
                style={{
                  flex: 1, padding: "7px 10px", fontSize: 12.5,
                  background: "var(--input-bg, rgba(255,255,255,0.05))",
                  border: "1px solid hsl(var(--border, 0 0% 25%))",
                  borderRadius: 6, color: "inherit", outline: "none",
                }}
              />
              <button
                onClick={() => { if (urlDraft.trim()) { onPick?.(urlDraft.trim()); onClose?.(); } }}
                disabled={!urlDraft.trim()}
                style={{
                  padding: "7px 14px", fontSize: 12.5, cursor: "pointer", borderRadius: 6,
                  border: "1px solid var(--accent-blue-border, #3b82f6)",
                  background: "var(--accent-blue-bg, rgba(59,130,246,0.15))", color: "inherit",
                }}
              >
                Use
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
