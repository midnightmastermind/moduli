// modules/ArtifactCard.jsx
// Renderer for role:"artifact" modules sitting in a container.
//   - thumbnail mode (default): compact preview (image / video frame / 🎵 / 📕)
//   - expanded mode: fills the parent instance row, with <video controls autoPlay>,
//     a scaled <img>, an <audio controls>, or an <iframe> for pdf. X button collapses.
import React, { useContext, useState, useCallback } from "react";
import { X, Maximize2, AlertCircle } from "lucide-react";
import { Spinner } from "../components/ui/spinner.jsx";
import { resolveFileRef } from "../helpers/fileRef";
import { getUploadController } from "../helpers/uploadWithProgress";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { GridActionsContext } from "../GridActionsContext.js";

export default function ArtifactCard({ module, label, occurrence }) {
  const [expanded, setExpanded] = useState(false);
  const { dispatch, socket, occurrencesById } = useContext(GridActionsContext) || {};
  const fileRef = module?.fileRef;
  const kind = module?.kind;
  const status = module?.meta?.uploadStatus;
  // Shared resolver — handles absolute URLs (Wikipedia drops) +
  // relative `/uploads/` refs (local uploads) uniformly.
  const src = resolveFileRef(fileRef);
  // Prefer sharp-generated thumbnails when present (files audit gap #4).
  // Compact card uses the 256px variant; expanded mode falls through to
  // the 1024px variant (download still goes to the original).
  // External / dedup'd / pre-sharp uploads have no thumbs — `src`
  // is the natural fallback in either size.
  const thumb256Src  = module?.meta?.thumb256  ? resolveFileRef(module.meta.thumb256)  : src;
  const thumb1024Src = module?.meta?.thumb1024 ? resolveFileRef(module.meta.thumb1024) : src;

  const toggle = useCallback((e) => {
    e?.stopPropagation();
    setExpanded((v) => !v);
  }, []);

  // Cancel an in-flight upload (audit gap #8): abort the XHR, delete the
  // placeholder occurrence + module, detach from the parent container's
  // occurrences[] so the row disappears immediately.
  const handleCancelUpload = useCallback((e) => {
    e?.stopPropagation();
    const occId = occurrence?.id;
    const ctrl = occId ? getUploadController(occId) : null;
    if (ctrl?.abort) {
      try { ctrl.abort(); } catch { /* ignore */ }
    }
    if (!occId || !dispatch || !socket) return;
    // Detach from parent container's occurrences[] (if known via the registry).
    const parentOccId = ctrl?.containerOccurrenceId;
    const parentOcc = parentOccId ? occurrencesById?.[parentOccId] : null;
    if (parentOcc) {
      CommitHelpers.updateOccurrence({
        dispatch, socket,
        occurrence: {
          id: parentOcc.id,
          occurrences: (parentOcc.occurrences || []).filter(id => id !== occId),
        },
        emit: true,
      });
    }
    CommitHelpers.deleteOccurrence({ dispatch, socket, occurrenceId: occId, occurrence, emit: true });
    if (module?.id) {
      CommitHelpers.deleteModule({ dispatch, socket, moduleId: module.id, emit: true });
    }
  }, [occurrence, module, dispatch, socket, occurrencesById]);

  if (status === "pending") {
    const rawProgress = typeof module?.meta?.uploadProgress === "number" ? module.meta.uploadProgress : 0;
    const pct = Math.max(0, Math.min(100, Math.round(rawProgress * 100)));
    const determinate = rawProgress > 0;
    return (
      <div className="artifact-card artifact-card--uploading" data-kind={kind}>
        <div className="artifact-upload-row">
          {determinate
            ? <span className="artifact-upload-pct">{pct}%</span>
            : <Spinner size="sm" />}
          <span className="artifact-upload-caption">{label || module?.label || "Uploading…"}</span>
          <button
            type="button"
            onClick={handleCancelUpload}
            className="artifact-upload-cancel"
            title="Cancel upload"
            aria-label="Cancel upload"
          >
            <X size={11} />
          </button>
        </div>
        <div className="artifact-upload-progress">
          <div className="artifact-upload-progress-bar" style={{ width: `${determinate ? pct : 8}%`, opacity: determinate ? 1 : 0.4 }} />
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="artifact-card artifact-card--upload-error" data-kind={kind}>
        <AlertCircle size={18} />
        <span className="artifact-upload-caption">{label || module?.label || "Upload failed"}</span>
      </div>
    );
  }

  if (!src) {
    return (
      <div className="artifact-card artifact-card--empty">
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label || "No file"}</span>
      </div>
    );
  }

  if (expanded) {
    // Per file/artifact audit #5/#20: surface the original filename +
    // human-readable size + a Download link in the expanded card chrome
    // so the user can see what they have and grab the original (the
    // stored filename is timestamp-randomized).
    const sizeLabel = formatBytes(module?.meta?.uploadSize);
    const originalName = module?.meta?.originalName || label || module?.label;
    return (
      <div className="artifact-card artifact-card--expanded" data-kind={kind}>
        <button className="artifact-expand-close" onClick={toggle} aria-label="Collapse">
          <X size={14} />
        </button>
        {renderExpanded(kind, src, label)}
        <div className="artifact-expanded-meta">
          {originalName && <span className="artifact-expanded-name" title={originalName}>{originalName}</span>}
          {sizeLabel && <span className="artifact-expanded-size">{sizeLabel}</span>}
          {src && (
            <a
              href={src}
              download={originalName || undefined}
              className="artifact-expanded-download"
              onClick={(e) => e.stopPropagation()}
              title="Download original"
            >
              Download
            </a>
          )}
        </div>
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

// Render a byte-count as "12 B" / "4.3 KB" / "1.2 MB" / "768.0 MB" /
// "1.5 GB". Returns null for missing / zero / negative values so callers
// can conditionally render. Powers the file-size chip in the expanded
// artifact card chrome (file/artifact audit #5).
function formatBytes(bytes) {
  if (bytes == null || bytes <= 0) return null;
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function renderThumbnail(kind, src, label) {
  if (kind === "image") return <img className="artifact-thumb" src={thumb256Src} alt={label || "image"} />;
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
  if (kind === "image") return <img className="artifact-expanded-media" src={thumb1024Src} alt={label || "image"} />;
  if (kind === "video") return <video className="artifact-expanded-media" src={src} controls playsInline />;
  if (kind === "audio") return (
    <div className="artifact-expanded-audio">
      <audio src={src} controls autoPlay style={{ width: "100%" }} />
      <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>{label}</span>
    </div>
  );
  if (kind === "pdf") return <iframe className="artifact-expanded-media" src={src} title={label || "pdf"} />;
  return <div style={{ padding: 16, color: "var(--text-muted)" }}>Unsupported kind: {kind}</div>;
}
