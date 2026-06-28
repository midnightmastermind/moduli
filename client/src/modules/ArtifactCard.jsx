// modules/ArtifactCard.jsx
// Renderer for role:"artifact" modules sitting in a container.
//   - thumbnail mode (default): compact preview (image / video frame / 🎵 / 📕)
//   - expanded mode: fills the parent instance row, with <video controls autoPlay>,
//     a scaled <img>, an <audio controls>, or an <iframe> for pdf. X button collapses.
import React, { useContext, useState, useCallback, useRef, useEffect } from "react";
import { X, Maximize2, AlertCircle } from "lucide-react";
import { Spinner } from "../components/ui/spinner.jsx";
import { resolveFileRef } from "../helpers/fileRef";
import { getUploadController } from "../helpers/uploadWithProgress";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { GridActionsContext, useGridActions } from "../GridActionsContext.js";

export default function ArtifactCard({ module, label, occurrence }) {
  const [expanded, setExpanded] = useState(false);
  const { dispatch, socket, occurrencesById } = useGridActions() || {};
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

  // Full-bleed logo (Viafluere top-middle cell): on first mount, scroll the
  // nearest scrollable ancestor so the LOGO sits vertically centered in the
  // cell — the container header + filename bar scroll up out of the way and the
  // description below is reached by scrolling further (user: "scroll a bit down
  // to start so the image is centered in the cell").
  const fullbleedRef = useRef(null);
  const isFullBleed = kind === "image" && !!module?.meta?.fullBleed;
  useEffect(() => {
    if (!isFullBleed) return;
    const el = fullbleedRef.current;
    if (!el) return;
    let sc = el.parentElement;
    while (sc && sc !== document.body) {
      const oy = getComputedStyle(sc).overflowY;
      if ((oy === "auto" || oy === "scroll") && sc.scrollHeight > sc.clientHeight + 4) break;
      sc = sc.parentElement;
    }
    if (!sc || sc === document.body) return;
    const t = setTimeout(() => {
      const er = el.getBoundingClientRect();
      const sr = sc.getBoundingClientRect();
      const delta = (er.top - sr.top) - Math.max(0, (sc.clientHeight - er.height) / 2);
      if (delta > 8) sc.scrollTop += delta;
    }, 140);
    return () => clearTimeout(t);
  }, [isFullBleed, src]);

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

  // Quote artifact — no file; renders a styled pull-quote block from
  // module.meta.{quote, attribution} (imported Wikipedia blockquotes / pull-quotes).
  if (kind === "quote") {
    const quote = module?.meta?.quote || label || "";
    const attribution = module?.meta?.attribution || "";
    return (
      <div className="artifact-card artifact-card--quote" data-kind="quote">
        <span className="artifact-quote-mark" aria-hidden="true">&ldquo;</span>
        <blockquote className="artifact-quote-text">{quote}</blockquote>
        {attribution && <cite className="artifact-quote-attr">&mdash; {attribution}</cite>}
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

  // Full-bleed logo variant (opt-in via module.meta.fullBleed): image fills the
  // card width (responsive, no crop), with the file name pinned top-right —
  // opposite the instance drag handle (which sits top-left). Used by the
  // Viafluere logo board in the top-middle grid cell.
  if (isFullBleed) {
    const fileName = module?.meta?.originalName || label || module?.label || "";
    return (
      <div ref={fullbleedRef} className="artifact-card artifact-card--fullbleed" data-kind="image">
        <div className="artifact-fullbleed-header">
          {fileName && <span className="artifact-fullbleed-name" title={fileName}>{fileName}</span>}
        </div>
        <img className="artifact-fullbleed-img" src={src} alt={label || "viafluere"} />
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
        {renderExpanded(kind, src, label, thumb1024Src)}
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

  // Image info shown in the otherwise-empty space beside the thumbnail (the user:
  // "too much space between the drag handle and the image — put the image info
  // there"). Name (alt / original filename), pixel dimensions, file size — whatever
  // is known (external Wikipedia images only carry the alt; uploads add dims+size).
  const imgName = module?.meta?.originalName || label || module?.label || null;
  const imgDims = (module?.meta?.width && module?.meta?.height) ? `${module.meta.width}×${module.meta.height}` : null;
  const imgSize = formatBytes(module?.meta?.uploadSize);
  const showImgInfo = kind === "image" && (imgName || imgDims || imgSize);

  return (
    <div
      className={showImgInfo ? "artifact-card artifact-card--with-info" : "artifact-card"}
      data-kind={kind}
      onClick={toggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggle(e); }}
    >
      {showImgInfo && (
        <div className="artifact-thumb-info">
          {imgName && <span className="artifact-thumb-info-name" title={imgName}>{imgName}</span>}
          {imgDims && <span className="artifact-thumb-info-dim">{imgDims}</span>}
          {imgSize && <span className="artifact-thumb-info-size">{imgSize}</span>}
        </div>
      )}
      {renderThumbnail(kind, src, label, thumb256Src)}
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

function renderThumbnail(kind, src, label, imgSrc = src) {
  if (kind === "image") return <img className="artifact-thumb" src={imgSrc} alt={label || "image"} />;
  if (kind === "video") return <video className="artifact-thumb" src={src} muted playsInline preload="metadata" />;
  if (kind === "audio") return (
    <div className="artifact-thumb artifact-thumb--audio" onClick={(e) => e.stopPropagation()}>
      <span style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
        🎵 {label || "audio"}
      </span>
      <audio src={src} controls preload="metadata" style={{ width: "100%", height: 32 }} />
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

function renderExpanded(kind, src, label, imgSrc = src) {
  if (kind === "image") return <img className="artifact-expanded-media" src={imgSrc} alt={label || "image"} />;
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
