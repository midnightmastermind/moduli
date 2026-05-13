// modules/ArtifactContent.jsx
// Pure content renderer for file-backed artifact modules.
// viewType: "markdown" → TipTap Editor (moduleEmbed nodes handle embedded containers inline)
// viewType: "artifact" + artifactType: "image"|"pdf"|"audio"|"video" → file renderer
// viewType: "code" → syntax-highlighted code block (fetches raw file content)
// view: passed from Panel — used to trigger scrollAnchor scroll in the editor
import { useContext, useRef, useEffect, useState, useCallback } from "react";
import { GridActionsContext } from "../GridActionsContext.js";
import Editor from "../ui/Editor.jsx";
import { hexToRgba } from "../helpers/colorHelpers.js";
import * as CommitHelpers from "../helpers/CommitHelpers.js";
import RadialMenu from "../ui/RadialMenu.jsx";
import { Settings } from "lucide-react";

function CodeViewer({ fileRef, label }) {
  const [code, setCode] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!fileRef) return;
    let mounted = true;
    fetch(`/uploads/${fileRef}`)
      .then(r => r.ok ? r.text() : Promise.reject(r.status))
      .then(text => { if (mounted) setCode(text); })
      .catch(() => { if (mounted) setError("Failed to load file"); });
    return () => { mounted = false; };
  }, [fileRef]);
  const ext = fileRef ? fileRef.split(".").pop().toLowerCase() : "";
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {label && (
        <div style={{ padding: "4px 10px", fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-faint)", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}>
          {label}{ext ? ` · .${ext}` : ""}
        </div>
      )}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
        {error ? (
          <span style={{ color: "rgba(255,80,80,0.7)", fontSize: 12, fontFamily: "var(--font-mono)" }}>{error}</span>
        ) : code == null ? (
          <span style={{ color: "var(--text-faint)", fontSize: 12, fontFamily: "var(--font-mono)" }}>Loading…</span>
        ) : (
          <pre style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.6, color: "var(--text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  );
}

export default function ArtifactContent({ occurrence, viewType, artifactType, embedded = false, dispatch, socket, view, onScrollHighlight }) {
  const { modulesById } = useContext(GridActionsContext);
  const module = occurrence?.moduleId ? modulesById?.[occurrence.moduleId] : null;
  const fileRef = module?.fileRef;
  const docAccentBg = hexToRgba(module?.ownStyle?.bg, 0.1) ?? null;
  const scrollRef = useRef(null);

  // Doc name editing state
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const nameInputRef = useRef(null);

  const handleStartRename = useCallback(() => {
    setNameValue(module?.label || "");
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.select(), 0);
  }, [module?.label]);

  const handleSaveName = useCallback(() => {
    setEditingName(false);
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== module?.label) {
      CommitHelpers.updateModule({ dispatch, socket, module: { id: module.id, label: trimmed } });
    }
  }, [nameValue, module, dispatch, socket]);

  // Normalize: if old-style viewType was image/pdf/audio/video, treat as display
  const normalizedArtifactType = artifactType
    || (["image", "pdf", "audio", "video"].includes(viewType) ? viewType : null);
  const isArtifact = viewType === "display" || normalizedArtifactType;

  // Scroll to embedded container by data-occ-id when scrollAnchor changes
  const suppressAutoSyncRef = useRef(false);
  useEffect(() => {
    if (!view?.scrollAnchor) return;
    const container = scrollRef.current;
    const target = container?.querySelector(`[data-occ-id="${view.scrollAnchor}"]`);
    if (target && container) {
      suppressAutoSyncRef.current = true;
      container.scrollTo({ top: container.scrollTop + target.getBoundingClientRect().top - container.getBoundingClientRect().top, behavior: "smooth" });
      setTimeout(() => { suppressAutoSyncRef.current = false; }, 600);
      target.classList.remove("anchor-highlight");
      void target.offsetWidth;
      target.classList.add("anchor-highlight");
      setTimeout(() => target.classList.remove("anchor-highlight"), 1200);
    }
  }, [view?.scrollAnchor]);

  // Auto-highlight sidebar anchor based on scroll position (IntersectionObserver)
  // Uses onScrollHighlight callback — does NOT modify activeOccurrenceId (which controls rendering)
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !onScrollHighlight) return;

    // Suppress for 600ms on mount — prevents firing during initial render
    suppressAutoSyncRef.current = true;
    const initTimer = setTimeout(() => { suppressAutoSyncRef.current = false; }, 600);

    let debounceTimer = null;
    let lastReportedId = null;

    const observer = new IntersectionObserver(
      (entries) => {
        if (suppressAutoSyncRef.current) return;
        let topEntry = null;
        let topY = Infinity;
        for (const entry of entries) {
          if (entry.isIntersecting && entry.boundingClientRect.top < topY) {
            topY = entry.boundingClientRect.top;
            topEntry = entry;
          }
        }
        if (!topEntry) return;
        const occId = topEntry.target.getAttribute("data-occ-id");
        if (!occId || occId === lastReportedId) return;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          lastReportedId = occId;
          onScrollHighlight(occId);
        }, 200);
      },
      { root: container, rootMargin: "-10% 0px -70% 0px", threshold: 0 }
    );

    const observe = () => {
      observer.disconnect();
      container.querySelectorAll("[data-occ-id]").forEach(el => observer.observe(el));
    };
    observe();

    const mo = new MutationObserver(observe);
    mo.observe(container, { childList: true, subtree: true });

    return () => { clearTimeout(initTimer); clearTimeout(debounceTimer); observer.disconnect(); mo.disconnect(); };
  }, [onScrollHighlight]);

  if (viewType === "code") {
    return <CodeViewer fileRef={fileRef} label={module?.label} />;
  }

  // Default to markdown for any non-artifact view
  // Embedded containers are moduleEmbed TipTap nodes — no React elements appended after editor
  if (!isArtifact || !normalizedArtifactType) {
    const docLabel = module?.label;

    const radialItems = [
      {
        icon: Settings,
        label: "Rename",
        onClick: handleStartRename,
        color: "bg-slate-600 hover:bg-slate-500",
      },
    ];

    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden", position: "relative", padding: "0px 3px 3px 3px", ...(docAccentBg ? { background: docAccentBg } : {}) }}>
        {/* Drag handle — outside bordered div so overflow:hidden doesn't clip it */}


        {/* Doc card with border */}
        <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", border: "1px solid var(--border-subtle)", borderRadius: 4, overflow: "hidden" }}>

          {/* Rename input — appears below handle when editing */}
          {editingName && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}>
              <input
                ref={nameInputRef}
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onBlur={handleSaveName}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveName(); if (e.key === "Escape") setEditingName(false); }}
                style={{
                  background: "var(--input-bg)", border: "1px solid var(--border-default)",
                  borderRadius: 3, padding: "2px 8px", fontSize: 11, fontFamily: "var(--font-mono)",
                  color: "var(--text-primary)", outline: "none", flex: 1,
                }}
                placeholder="Document name"
                autoFocus
              />
            </div>
          )}

          {/* Doc label badge — top right */}
          {docLabel && !editingName && (
            <div style={{ position: "absolute", top: 2, right: 10, zIndex: 10, fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-faint)", userSelect: "none", pointerEvents: "none", letterSpacing: "0.03em" }}>
              {docLabel}
            </div>
          )}

          <div ref={scrollRef} className="artifact-markdown" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
            <Editor
              occurrence={occurrence}
              content={occurrence?.textmap && typeof occurrence.textmap === "object" ? occurrence.textmap : null}
              dispatch={dispatch}
              socket={socket}
              placeholder="Start writing…"
            />
          </div>
        </div>
      </div>
    );
  }

  if (normalizedArtifactType === "image" && fileRef) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", overflow: "auto", padding: 16 }}>
        <img
          src={`/uploads/${fileRef}`}
          alt={module?.label || fileRef}
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
        />
      </div>
    );
  }

  if (normalizedArtifactType === "pdf" && fileRef) {
    return (
      <iframe
        src={`/uploads/${fileRef}`}
        style={{ width: "100%", height: "100%", border: "none" }}
        title={module?.label}
      />
    );
  }

  if (normalizedArtifactType === "audio" && fileRef) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: 24 }}>
        <audio src={`/uploads/${fileRef}`} controls style={{ width: "100%", maxWidth: 480 }} />
      </div>
    );
  }

  if (normalizedArtifactType === "video" && fileRef) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", overflow: "hidden", padding: 16 }}>
        <video
          src={`/uploads/${fileRef}`}
          controls
          style={{ maxWidth: "100%", maxHeight: "100%" }}
        />
      </div>
    );
  }

  // No fileRef or unknown type
  return (
    <div style={{ padding: 24, color: "var(--text-muted)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
      {fileRef ? `Unknown artifact type: ${normalizedArtifactType}` : "No file attached"}
    </div>
  );
}
