// modules/ArtifactCard.jsx
// Renderer for role:"artifact" modules sitting in a container.
//   - thumbnail mode (default): compact preview (image / video frame / 🎵 / 📕)
//   - expanded mode: fills the parent instance row, with <video controls autoPlay>,
//     a scaled <img>, an <audio controls>, or an <iframe> for pdf. X button collapses.
import React, { useState, useCallback } from "react";
import { X, Maximize2 } from "lucide-react";

export default function ArtifactCard({ module, label }) {
  const [expanded, setExpanded] = useState(false);
  const fileRef = module?.fileRef;
  const kind = module?.kind;
  const src = fileRef ? `/uploads/${fileRef}` : null;

  const toggle = useCallback((e) => {
    e?.stopPropagation();
    setExpanded((v) => !v);
  }, []);

  if (!src) {
    return (
      <div className="artifact-card artifact-card--empty">
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label || "No file"}</span>
      </div>
    );
  }

  if (expanded) {
    return (
      <div className="artifact-card artifact-card--expanded" data-kind={kind}>
        <button className="artifact-expand-close" onClick={toggle} aria-label="Collapse">
          <X size={14} />
        </button>
        {renderExpanded(kind, src, label)}
      </div>
    );
  }

  return (
    <div
      className="artifact-card"
      data-kind={kind}
      onClick={toggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggle(e); }}
    >
      {renderThumbnail(kind, src, label)}
      <Maximize2 className="artifact-thumb-expand-hint" size={12} />
    </div>
  );
}

function renderThumbnail(kind, src, label) {
  if (kind === "image") return <img className="artifact-thumb" src={src} alt={label || "image"} />;
  if (kind === "video") return <video className="artifact-thumb" src={src} muted playsInline preload="metadata" />;
  if (kind === "audio") return (
    <div className="artifact-thumb artifact-thumb--audio">
      <span style={{ fontSize: 18 }}>🎵</span>
      <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{label || "audio"}</span>
    </div>
  );
  if (kind === "pdf") return (
    <div className="artifact-thumb artifact-thumb--pdf">
      <span style={{ fontSize: 18 }}>📕</span>
      <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{label || "pdf"}</span>
    </div>
  );
  return (
    <div className="artifact-thumb artifact-thumb--unknown">
      <span style={{ fontSize: 10 }}>{label || "file"}</span>
    </div>
  );
}

function renderExpanded(kind, src, label) {
  if (kind === "image") return <img className="artifact-expanded-media" src={src} alt={label || "image"} />;
  if (kind === "video") return <video className="artifact-expanded-media" src={src} controls autoPlay playsInline />;
  if (kind === "audio") return (
    <div className="artifact-expanded-audio">
      <audio src={src} controls autoPlay style={{ width: "100%" }} />
      <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>{label}</span>
    </div>
  );
  if (kind === "pdf") return <iframe className="artifact-expanded-media" src={src} title={label || "pdf"} />;
  return <div style={{ padding: 16, color: "var(--text-muted)" }}>Unsupported kind: {kind}</div>;
}
