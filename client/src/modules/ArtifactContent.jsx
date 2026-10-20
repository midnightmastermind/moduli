// modules/ArtifactContent.jsx
// Pure content renderer for file-backed artifact modules.
// viewType: "markdown" → TipTap Editor (moduleEmbed nodes handle embedded containers inline)
// viewType: "artifact" + artifactType: "image"|"pdf"|"audio"|"video" → file renderer
// viewType: "code" → syntax-highlighted code block (fetches raw file content)
// view: passed from Panel — used to trigger scrollAnchor scroll in the editor
import AudioWaveform from "./AudioWaveform.jsx";
import PlaceMedia from "../ui/PlaceMedia.jsx";
import { flashElement } from "../helpers/jumpToOccurrence";
import BookmarkView from "./BookmarkView.jsx";
import BookReader from "./BookReader.jsx";
import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useGridActions } from "../GridActionsContext.js";
import Editor from "../ui/Editor.jsx";
import { hexToRgba } from "../helpers/colorHelpers.js";
import * as CommitHelpers from "../helpers/CommitHelpers.js";
import { resolveFileRef } from "../helpers/fileRef.js";
import ZoomableImage from "../ui/ZoomableImage.jsx";
import { Spinner } from "../components/ui/spinner";
import LoadingImage from "../ui/LoadingImage.jsx";
import ImageOcrViews from "./ImageOcrViews.jsx";
// The global image picker (search / upload / URL). Its single host is mounted in
// App.jsx and call sites open it imperatively — the same way ui/QuickAddMenu does.
// The "Replace" button below called this WITHOUT the import, so clicking it threw
// a ReferenceError instead of opening the picker.
import { openImagePicker } from "../ui/ImagePickerMenu";
import "highlight.js/styles/atom-one-dark.css";
import { Settings, Download, ImagePlus } from "lucide-react";

// Human-readable byte count. Mirrors ArtifactCard's formatBytes —
// duplicated rather than imported so each viewer surface stays
// self-contained. ~5 lines, deliberately small.
function formatBytes(bytes) {
  if (bytes == null || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

// Floating "save to disk" affordance used by the image / pdf / audio /
// video / code viewer surfaces. Click triggers a browser download under
// the original filename (not the timestamp-randomized server filename).
// Docket §8 gap #20 — page-level analog of the in-card download link
// that already lives in ArtifactCard expanded mode.
function ArtifactDownloadBadge({ fileRef, originalName, size, style }) {
  if (!fileRef) return null;
  const sizeLabel = formatBytes(size);
  return (
    <a
      href={resolveFileRef(fileRef)}
      download={originalName || ""}
      title={originalName ? `Download ${originalName}${sizeLabel ? ` (${sizeLabel})` : ""}` : "Download original"}
      style={{
        position: "absolute", top: 10, right: 10, zIndex: 5,
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "4px 10px", borderRadius: 14,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        color: "rgba(255,255,255,0.92)", textDecoration: "none",
        fontFamily: "var(--font-mono)", fontSize: 12,
        border: "1px solid rgba(255,255,255,0.18)",
        ...(style || {}),
      }}
    >
      <Download size={12} />
      <span style={{ maxWidth: 200, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {originalName || "Download"}
      </span>
      {sizeLabel && <span style={{ opacity: 0.7 }}>· {sizeLabel}</span>}
    </a>
  );
}

// Extension → highlight.js language id. Common cases only; anything not in
// the map falls through to highlightAuto.
const EXT_TO_LANG = {
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
  c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", swift: "swift",
  kt: "kotlin", scala: "scala", php: "php", pl: "perl", lua: "lua",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  json: "json", yaml: "yaml", yml: "yaml", toml: "ini", ini: "ini",
  xml: "xml", html: "xml", svg: "xml",
  css: "css", scss: "scss", sass: "scss", less: "less",
  md: "markdown", markdown: "markdown",
  sql: "sql", graphql: "graphql", dockerfile: "dockerfile",
  vue: "xml", svelte: "xml",
};

function CodeViewer({ fileRef, label, originalName, size }) {
  const [code, setCode] = useState(null);
  const [error, setError] = useState(null);
  const [hljs, setHljs] = useState(null);
  useEffect(() => {
    if (!fileRef) return;
    let mounted = true;
    fetch(resolveFileRef(fileRef))
      .then(r => r.ok ? r.text() : Promise.reject(r.status))
      .then(text => { if (mounted) setCode(text); })
      .catch(() => { if (mounted) setError("Failed to load file"); });
    return () => { mounted = false; };
  }, [fileRef]);
  useEffect(() => {
    let mounted = true;
    import("highlight.js").then((mod) => { if (mounted) setHljs(() => mod.default); });
    return () => { mounted = false; };
  }, []);
  const ext = fileRef ? fileRef.split(".").pop().toLowerCase() : "";
  const lang = EXT_TO_LANG[ext] || null;
  const highlighted = useMemo(() => {
    if (code == null || !hljs) return null;
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch {
      return null;
    }
  }, [code, hljs, lang]);
  const sizeLabel = formatBytes(size);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {(label || fileRef) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-faint)", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {label || ""}{ext ? ` · .${ext}` : ""}{lang ? ` · ${lang}` : ""}{sizeLabel ? ` · ${sizeLabel}` : ""}
          </span>
          {fileRef && (
            <a
              href={resolveFileRef(fileRef)}
              download={originalName || ""}
              title={originalName ? `Download ${originalName}` : "Download"}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--text-muted)", textDecoration: "none", padding: "2px 6px", borderRadius: 3 }}
            >
              <Download size={11} />
              <span>Download</span>
            </a>
          )}
        </div>
      )}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
        {error ? (
          <span style={{ color: "rgba(255,80,80,0.7)", fontSize: 12, fontFamily: "var(--font-mono)" }}>{error}</span>
        ) : code == null ? (
          <span style={{ color: "var(--text-faint)", fontSize: 12, fontFamily: "var(--font-mono)" }}>Loading…</span>
        ) : (
          <pre style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.6, color: "var(--text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-all", background: "transparent" }}>
            {highlighted != null ? (
              <code className={`hljs${lang ? ` language-${lang}` : ""}`} dangerouslySetInnerHTML={{ __html: highlighted }} />
            ) : (
              <code>{code}</code>
            )}
          </pre>
        )}
      </div>
    </div>
  );
}


// THE IMAGE FITS THE PANEL, NOT THE WINDOW (UI sweep 52). The cap was
// `min(70vh, 800px)`: in a half-height panel the picture ran past the fold and its
// zoom controls (bottom-left of the frame) could only be reached by scrolling.
// The pane's own height, less the media row's 16px padding top and bottom, is the
// cap once measured; the old cap stands until then.
export function imageFrameCap(paneH) {
  return paneH > 0 ? `${Math.max(160, Math.min(800, paneH - 32))}px` : "min(70vh, 800px)";
}

function ImagePane({ children }) {
  const ref = useRef(null);
  const [h, setH] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%", overflow: "auto" }}>
      {children(h)}
    </div>
  );
}

export default function ArtifactContent({ occurrence, viewType, artifactType, embedded = false, dispatch, socket, view, onScrollHighlight, headerExtra = null }) {
  const { modulesById, occurrencesById, gridId, userId } = useGridActions();
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
    || (["image", "pdf", "ebook", "audio", "video", "bookmark"].includes(viewType) ? viewType : null);
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
      flashElement(target);
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
    return (
      <CodeViewer
        fileRef={fileRef}
        label={module?.label}
        originalName={module?.meta?.originalName}
        size={module?.meta?.uploadSize}
      />
    );
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
                  borderRadius: 3, padding: "2px 8px", fontSize: 12, fontFamily: "var(--font-mono)",
                  color: "var(--text-primary)", outline: "none", flex: 1,
                }}
                placeholder="Document name"
                autoFocus
              />
            </div>
          )}

          {/* Doc label badge — top right */}
          {docLabel && !editingName && (
            <div style={{ position: "absolute", top: 2, right: 10, zIndex: 10, fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-faint)", userSelect: "none", pointerEvents: "none", letterSpacing: "0.03em" }}>
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

  const originalName = module?.meta?.originalName || module?.label || null;
  const uploadSize = module?.meta?.uploadSize;

  // A BOOKMARK's `actual` view — the web page its `fileRef` points at.
  //
  // One more branch beside image/pdf/audio/video rather than a new surface,
  // because `role: "artifact"` already is the module type for "a thing with
  // content of its own" and its cascade already declares the two views the user
  // asked for: `navOptions: ["preview", "actual"]` — *"an entire page or a
  // preview of it"*. `preview` is the card and needs no iframe; this is `actual`.
  // NO `&& fileRef` HERE. A SCRATCH BROWSER HAS NO URL YET — that is its whole
  // starting state — and requiring one sent it to the markdown branch, i.e. a
  // doc editor. `BookmarkView` owns the empty case itself (an address bar and
  // an invitation to type), so the router must let it decide rather than
  // deciding for it from an absent value.
  if (normalizedArtifactType === "bookmark") {
    return <BookmarkView occurrence={occurrence} module={module} socket={socket} isActivePage />;
  }

  if (normalizedArtifactType === "image" && fileRef) {
    const childOccIds = Array.isArray(occurrence?.occurrences) ? occurrence.occurrences : [];
    const childTextblocks = childOccIds
      .map(id => occurrencesById?.[id])
      .filter(o => o && modulesById?.[o.moduleId]?.role === "textblock");
    const imgSrc = resolveFileRef(fileRef);
    // Stamped by the server's EXIF pass on upload (server gap #12). Absent for
    // remote-ref images — a Wikipedia drop never went through that path.
    const natW = Number(module?.meta?.width) || 0;
    const natH = Number(module?.meta?.height) || 0;
    return (
      <ImageOcrViews occurrence={occurrence} module={module} imgSrc={imgSrc}
        dispatch={dispatch} socket={socket} gridId={gridId} userId={userId}>
      <ImagePane>{(paneH) => (<>
        {/* Media — flex:0 so it sizes to its natural height; child textblocks
            stack underneath instead of being pushed off-screen. */}
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, flex: "0 0 auto" }}>
          {/* A BARE <img> COLLAPSES TO ITS ALT TEXT WHILE LOADING. That is both
              halves of the user's 2026-08-24 report: the frame showed the label
              as PLACEHOLDER TEXT rather than a loading circle, and the box was
              the size of that text rather than the size of the picture — so the
              layout jumped when the image arrived.

              `meta.width`/`meta.height` are stamped on every image upload by the
              server's EXIF pass, so the real box is usually KNOWN before a byte
              of the image has loaded: reserving it as an aspect-ratio makes the
              frame the picture's size from the first frame. Falling back to a
              square floor rather than guessing an aspect keeps an image with no
              stored dimensions from reserving a WRONG shape, which would jump
              just as badly in the other direction. */}
          <ZoomableImage
            frameStyle={
              natW > 0 && natH > 0
                ? { display: "block", aspectRatio: `${natW} / ${natH}`, width: "100%", maxWidth: "100%", maxHeight: imageFrameCap(paneH) }
                : { display: "block", width: "100%", minHeight: 160, height: imageFrameCap(paneH), maxWidth: "100%" }
            }
          >
            <LoadingImage
              src={imgSrc}
              alt={module?.label || fileRef}
              spinnerSize="lg"
              imgStyle={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
              frameStyle={{ position: "relative", display: "block", width: "100%", height: "100%" }}
            />
          </ZoomableImage>
          {/* Replace + Download share ONE top-right row (UI sweep 2026-10-20, phone): Replace was pinned at
              `right: 290px` — a guess at the badge's width — so on a phone it hung off the left edge and on a
              wide pane with a short name it floated far from the badge. The file name shrinks first. */}
          <div style={{ position: "absolute", top: 10, right: 10, zIndex: 5, display: "flex", gap: 6, maxWidth: "calc(100% - 20px)" }}>
          {/* Replace image — search / upload / URL via the global picker.
              The pick rewrites module.fileRef, so every placement of this
              artifact updates. */}
          <button
            onClick={(e) => {
              e.preventDefault();
              openImagePicker({
                query: module?.label || originalName || "",
                title: `Replace image — ${module?.label || originalName || "artifact"}`,
                onPick: (url) => {
                  CommitHelpers.updateModule({ dispatch, socket, module: { ...module, fileRef: url }, emit: true });
                },
              });
            }}
            title="Replace this image (search the web, upload, or paste a URL)"
            style={{
              flexShrink: 0,
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "4px 10px", borderRadius: 14,
              background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              color: "rgba(255,255,255,0.92)",
              fontFamily: "var(--font-mono)", fontSize: 12,
              border: "1px solid rgba(255,255,255,0.18)",
              cursor: "pointer",
            }}
          >
            <ImagePlus size={12} />
            <span>Replace</span>
          </button>
          <ArtifactDownloadBadge fileRef={fileRef} originalName={originalName} size={uploadSize} style={{ position: "static", minWidth: 0 }} />
          </div>
        </div>
        {/* OCR result(s) — one editable textblock per OCR run. */}
        {childTextblocks.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "0 16px 16px 16px", borderTop: "1px solid var(--border-subtle)" }}>
            {childTextblocks.map(tbOcc => (
              <div key={tbOcc.id} style={{ padding: "8px 0" }}>
                <Editor
                  occurrence={tbOcc}
                  content={tbOcc.textmap && typeof tbOcc.textmap === "object" ? tbOcc.textmap : null}
                  dispatch={dispatch}
                  socket={socket}
                  placeholder="Extracted text…"
                />
              </div>
            ))}
          </div>
        )}
      </>)}</ImagePane>
      </ImageOcrViews>
    );
  }

  // A PDF or an e-book opens in the book reader: Book (the file as written) · Magic (the page on
  // screen as occurrences). It is already the panel's page here, so no Open in panel. A PDF's Book mode is the pdf.js viewer it always was.
  if ((normalizedArtifactType === "pdf" || normalizedArtifactType === "ebook") && fileRef) {
    return (
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <BookReader module={module} occurrence={occurrence} src={resolveFileRef(fileRef)}
          kind={normalizedArtifactType} inPanelPage dispatch={dispatch} socket={socket} headerExtra={headerExtra} />
      </div>
    );
  }

  if (normalizedArtifactType === "audio" && fileRef) {
    return (
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: 24 }}>
        <AudioWaveform src={resolveFileRef(fileRef)} moduleId={module?.id} />
        <ArtifactDownloadBadge fileRef={fileRef} originalName={originalName} size={uploadSize} />
      </div>
    );
  }

  if (normalizedArtifactType === "video" && fileRef) {
    return (
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", height: "100%", overflow: "hidden", padding: 16 }}>
        <PlaceMedia
          as="video"
          moduleId={module?.id}
          src={resolveFileRef(fileRef)}
          controls
          style={{ maxWidth: "100%", maxHeight: "100%" }}
        />
        <ArtifactDownloadBadge fileRef={fileRef} originalName={originalName} size={uploadSize} />
      </div>
    );
  }

  // The file's record has not arrived yet (files come in the later half of the
  // load) or its upload is still running: say it is loading, not that it is missing.
  if (!fileRef && (!module || module?.meta?.uploadStatus === "pending")) {
    return (
      <div className="artifact-loading" style={{ display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", gap: 10, height: "100%", minHeight: 160, color: "var(--text-muted)",
        fontSize: 12, fontFamily: "var(--font-mono)" }}>
        <Spinner size="lg" />
        Loading file…
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
