// modules/Artifact.jsx
// Pure content renderer for file-backed artifact modules.
// viewType: "markdown" → TipTap Editor (moduleEmbed nodes handle embedded containers inline)
// viewType: "artifact" + artifactType: "image"|"pdf"|"audio"|"video" → file renderer
// viewType: "code" → syntax-highlighted code block (fetches raw file content)
// view: passed from Panel — used to trigger scrollAnchor scroll in the editor
import { useContext, useRef, useEffect, useState } from "react";
import { GridActionsContext } from "../GridActionsContext.js";
import Editor from "../ui/Editor.jsx";
import { hexToRgba } from "../helpers/colorHelpers.js";

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

export default function Artifact({ occurrence, viewType, artifactType, embedded = false, dispatch, socket, view }) {
  const { modulesById } = useContext(GridActionsContext);
  const module = occurrence?.targetId ? modulesById?.[occurrence.targetId] : null;
  const fileRef = module?.fileRef;
  const docAccentBg = hexToRgba(module?.ownStyle?.bg, 0.1) ?? null;
  const scrollRef = useRef(null);

  // Normalize: if old-style viewType was image/pdf/audio/video, treat as artifact
  const normalizedArtifactType = artifactType
    || (["image", "pdf", "audio", "video"].includes(viewType) ? viewType : null);
  const isArtifact = viewType === "artifact" || normalizedArtifactType;

  // Scroll to embedded container by data-occ-id when scrollAnchor changes
  useEffect(() => {
    if (!view?.scrollAnchor) return;
    const target = scrollRef.current?.querySelector(`[data-occ-id="${view.scrollAnchor}"]`);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [view?.scrollAnchor]);

  if (viewType === "code") {
    return <CodeViewer fileRef={fileRef} label={module?.label} />;
  }

  // Default to markdown for any non-artifact view
  // Embedded containers are moduleEmbed TipTap nodes — no React elements appended after editor
  if (!isArtifact || !normalizedArtifactType) {
    const docLabel = module?.label;
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden", position: "relative", ...(docAccentBg ? { background: docAccentBg } : {}) }}>
        {docLabel && (
          <div style={{ position: "absolute", top: 6, right: 10, zIndex: 10, fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-faint)", userSelect: "none", pointerEvents: "none", letterSpacing: "0.03em" }}>
            {docLabel}
          </div>
        )}
        <div ref={scrollRef} className="artifact-markdown" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          <Editor
            occurrence={occurrence}
            content={occurrence?.textmap ?? null}
            dispatch={dispatch}
            socket={socket}
            showToolbar
            stickyToolbar
            placeholder="Start writing…"
          />
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
